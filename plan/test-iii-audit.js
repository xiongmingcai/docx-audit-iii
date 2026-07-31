/**
 * iii 异步审核路径端到端测试
 *
 * 模拟前端：创建 Channel → 上传文件 → 触发 docx::audit_start
 * → 轮询 docx::audit_status → 验证 CSV 报告生成
 *
 * 运行：node plan/test-iii-audit.js
 */
const fs = require('fs');
const path = require('path');
const WebSocket = require('/home/robert/development/static_tax/node_modules/ws');

const ENGINE_URL = 'ws://localhost:49134';
const DOC = path.resolve(__dirname, '副本景嘉微智能文档项目合同-需求和验收标准-0311(1)(1).docx');

async function main() {
  if (!fs.existsSync(DOC)) { console.error('文档不存在:', DOC); process.exit(1); }
  const fileBuf = fs.readFileSync(DOC);
  console.log(`📄 文档: ${path.basename(DOC)} (${(fileBuf.length/1024).toFixed(1)} KB)`);

  // 1. 连接引擎
  const { registerWorker, createChannel } = require('iii-browser-sdk');
  const iii = await registerWorker(ENGINE_URL, { workerName: 'test-iii-audit', invocationTimeoutMs: 600_000 });
  console.log('🔗 连接引擎成功');

  // 2. 创建 Channel
  const channel = await createChannel(iii, 1024 * 1024);
  console.log('📡 Channel 创建成功:', channel.readerRef.channel_id.slice(0, 8) + '…');

  // 3. 触发 docx::audit_start（worker 从 channel 读文件）
  console.log('🚀 触发 docx::audit_start …');
  const startPromise = iii.trigger({
    function_id: 'docx::audit_start',
    payload: {
      channel_ref: channel.readerRef,
      filename: path.basename(DOC),
      use_llm: true,
      check_comments: true,
    },
  });

  // 4. 同时上传文件到 channel writer
  console.log('⬆️  流式上传文件 …');
  await writeToChannel(channel, fileBuf);
  console.log('✅ 文件上传完成');

  // 5. 等接单结果
  const startResult = await startPromise;
  console.log('\n📋 接单结果:', JSON.stringify(startResult, null, 2));

  if (!startResult || !startResult.ok) {
    console.error('❌ 接单失败:', startResult?.error || '未知');
    process.exit(1);
  }

  const jobId = startResult.job_id;
  console.log(`\n🔍 Job ID: ${jobId}`);
  console.log(`   Trace: ${startResult.trace_id || '-'}`);
  console.log(`   静态问题: ${startResult.static_issues?.length ?? 0}`);
  console.log(`   Agent 批次: ${startResult.agent_enqueued}/${Math.ceil((startResult.agent_total_paras||0)/15)}`);

  // 6. 轮询 audit_status 直到完成
  console.log('\n⏳ 轮询进度 …');
  const maxWait = 5 * 60 * 1000; // 5 分钟
  const t0 = Date.now();
  let lastStatus = '';
  while (Date.now() - t0 < maxWait) {
    await sleep(3000);
    const st = await iii.trigger({ function_id: 'docx::audit_status', payload: { job_id: jobId } });
    if (!st || st.error) { console.log('   轮询错误:', st?.error || 'null'); continue; }
    const step = st.step || '?';
    const done = st.done_batches ?? 0;
    const total = st.total_batches ?? 0;
    const issues = st.issue_count ?? 0;
    const line = `   [${step}] ${total>0 ? `${done}/${total} 批` : ''} 问题 ${issues}`;
    if (line !== lastStatus) { console.log(line); lastStatus = line; }
    if (step === 'completed' || st.status === 'completed') {
      console.log('\n✅ 审核完成!');
      console.log('   报告路径:', st.report_path || '-');
      console.log('   总问题:', st.total_issues ?? issues);
      console.log('   Agent issues:', st.agent_issues?.length ?? 0);
      await iii.shutdown?.();
      return;
    }
    if (step === 'failed' || st.error) {
      console.error('\n❌ 审核失败:', JSON.stringify(st.error || st, null, 2));
      await iii.shutdown?.();
      process.exit(1);
    }
  }
  console.error('⏰ 超时');
  await iii.shutdown?.();
  process.exit(1);
}

function writeToChannel(channel, buf) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(channel.writer.url);
    ws.binaryType = 'arraybuffer';
    ws.onerror = (e) => reject(new Error('WS error: ' + (e.message || e.type)));
    ws.onopen = () => {
      const CHUNK = 64 * 1024;
      let offset = 0;
      const send = () => {
        if (offset >= buf.length) { ws.close(); resolve(); return; }
        const end = Math.min(offset + CHUNK, buf.length);
        ws.send(buf.slice(offset, end));
        offset = end;
        setTimeout(send, 0);
      };
      send();
    };
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('💥', e); process.exit(1); });
