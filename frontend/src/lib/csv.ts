import type { AuditIssue } from '@/types';

function escapeCell(value: string): string {
  // RFC 4180: 含逗号/引号/换行则整段引号包裹，内部引号翻倍
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 客户端生成 CSV（与后端 report.py 同结构：Key, P, 类型, 问题, 修改建议, 位置） */
export function issuesToCsv(issues: AuditIssue[], project = 'DOC'): string {
  const header = ['Key', 'P', '类型', '问题', '修改建议', '位置'];
  const rows = issues.map((issue, i) => {
    const key = `${project}-${String(i + 1).padStart(3, '0')}`;
    const location = (issue.context ?? '').slice(0, 30).replace(/\s+/g, ' ');
    return [
      key,
      issue.priority ?? '',
      issue.issue_type ?? '',
      (issue.message ?? '').slice(0, 80),
      (issue.suggestion ?? '').slice(0, 80),
      location,
    ]
      .map((c) => escapeCell(c))
      .join(',');
  });
  const bom = '﻿';
  return bom + [header.join(','), ...rows].join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
