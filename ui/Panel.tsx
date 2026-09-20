import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hana } from '@hana/plugin-sdk';
import { HanaThemeProvider } from '@hana/plugin-components';
import '@hana/plugin-components/styles.css';
import './panel.css';

type WindowReading = {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: string | null;
  windowSeconds: number | null;
};

type BalanceReading = { label: string; currency: string; amount: number };

type Reading = {
  providerId: string;
  name: string;
  kind: 'window' | 'balance';
  status: 'ok' | 'unconfigured' | 'auth_expired' | 'fetch_failed' | 'parse_failed';
  updatedAt: string;
  plan: string | null;
  source?: 'cli-file' | 'config';
  windows: WindowReading[];
  balances: BalanceReading[];
  error?: string;
};

type Snapshot = {
  readings: Reading[];
  lastPollAt: string | null;
  thresholds: { warn: number; critical: number };
  providers: { id: string; name: string; kind: string }[];
};

type DiscoveryItem = {
  providerId: string;
  name: string;
  type: 'cli-file' | 'config-key';
  path?: string;
  found?: boolean;
  parsed?: boolean;
  expired?: boolean;
  configKey?: string;
  configured?: boolean;
};

function fmtCountdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return '即将重置';
  const minutes = Math.floor(ms / 60000);
  if (minutes >= 60 * 24) return `${Math.floor(minutes / (60 * 24))} 天后重置`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m 后重置`;
  return `${minutes}m 后重置`;
}

function fmtUpdated(iso: string | null): string {
  if (!iso) return '尚未刷新';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60000) return '刚刚更新';
  if (ms < 3600000) return `${Math.floor(ms / 60000)} 分钟前更新`;
  return `${Math.floor(ms / 3600000)} 小时前更新`;
}

function fmtAmount(amount: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

type Level = 'normal' | 'warn' | 'critical';

function levelOf(usedPercent: number, t: { warn: number; critical: number }): Level {
  if (usedPercent >= t.critical) return 'critical';
  if (usedPercent >= t.warn) return 'warn';
  return 'normal';
}

function overallLevel(readings: Reading[], t: { warn: number; critical: number }): Level {
  let level: Level = 'normal';
  for (const r of readings) {
    if (r.status !== 'ok') continue;
    for (const w of r.windows) {
      const l = levelOf(w.usedPercent, t);
      if (l === 'critical') return 'critical';
      if (l === 'warn') level = 'warn';
    }
  }
  return level;
}

function WindowBar({ usedPercent, level }: { usedPercent: number; level: Level }) {
  return (
    <div className="pulse-bar">
      <div className={`pulse-bar-fill pulse-bar-${level}`} style={{ width: `${Math.min(Math.max(usedPercent, 0), 100)}%` }} />
    </div>
  );
}

function ProviderCard({
  reading,
  thresholds,
  expanded,
  onToggle,
}: {
  reading: Reading;
  thresholds: { warn: number; critical: number };
  expanded: boolean;
  onToggle: () => void;
}) {
  if (reading.status === 'unconfigured') return null;

  if (reading.status !== 'ok') {
    const label = reading.status === 'auth_expired' ? '凭据过期' : '读取失败';
    return (
      <div className="pulse-card pulse-card-degraded">
        <div className="pulse-card-head">
          <span className="pulse-dot pulse-dot-degraded" />
          <span className="pulse-card-name pulse-muted">{reading.name}</span>
          <span className="pulse-tag pulse-muted">{label}</span>
        </div>
        <div className="pulse-sub pulse-muted">
          {reading.status === 'auth_expired' ? '重新登录后自动恢复' : (reading.error ?? '稍后自动重试')}
        </div>
      </div>
    );
  }

  const kindLabel = reading.kind === 'balance' ? '余额' : '订阅';
  const sorted = [...reading.windows].sort((a, b) => b.usedPercent - a.usedPercent);
  const primary = sorted[0] ?? null;
  const rest = sorted.slice(1);
  const primaryLevel = primary ? levelOf(primary.usedPercent, thresholds) : 'normal';

  return (
    <div className={`pulse-card${expanded ? ' pulse-card-open' : ''}`} onClick={onToggle} role="button" tabIndex={0}>
      <div className="pulse-card-head">
        <span className={`pulse-dot pulse-dot-${primaryLevel}`} />
        <span className="pulse-card-name">{reading.name}</span>
        {reading.plan && <span className="pulse-muted pulse-plan">{reading.plan}</span>}
        <span className="pulse-tag">{kindLabel}</span>
      </div>

      {reading.kind === 'balance' ? (
        <div className="pulse-metric-row">
          <span className="pulse-metric">
            {reading.balances.length > 0 ? fmtAmount(reading.balances[0].amount, reading.balances[0].currency) : '—'}
          </span>
          <span className="pulse-sub">API 余额 · 无重置窗口</span>
        </div>
      ) : primary ? (
        <>
          <div className="pulse-metric-row">
            <span className={`pulse-metric pulse-metric-${primaryLevel}`}>{Math.round(100 - primary.usedPercent)}%</span>
            <span className="pulse-sub">剩余 · {primary.label}</span>
          </div>
          <WindowBar usedPercent={primary.usedPercent} level={primaryLevel} />
          <div className={`pulse-sub${primaryLevel !== 'normal' ? ` pulse-text-${primaryLevel}` : ''}`}>
            {fmtCountdown(primary.resetsAt) ?? '重置时间未知'}
          </div>
        </>
      ) : (
        <div className="pulse-sub pulse-muted">暂无窗口读数</div>
      )}

      {expanded && (
        <div className="pulse-detail" onClick={(e) => e.stopPropagation()}>
          {rest.map((w) => {
            const l = levelOf(w.usedPercent, thresholds);
            return (
              <div key={w.id} className="pulse-detail-window">
                <div className="pulse-detail-row">
                  <span>{w.label}</span>
                  <span className="pulse-tabular">
                    剩 {Math.round(100 - w.usedPercent)}%{fmtCountdown(w.resetsAt) ? ` · ${fmtCountdown(w.resetsAt)}` : ''}
                  </span>
                </div>
                <WindowBar usedPercent={w.usedPercent} level={l} />
              </div>
            );
          })}
          {reading.balances.slice(1).map((b, i) => (
            <div key={i} className="pulse-detail-row">
              <span>{b.label}</span>
              <span className="pulse-tabular">{fmtAmount(b.amount, b.currency)}</span>
            </div>
          ))}
          <div className="pulse-detail-foot">
            <span>{reading.source === 'cli-file' ? '本机 CLI 凭据' : '插件配置 API key'}</span>
            <span>{fmtUpdated(reading.updatedAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function WidgetView() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await hana.api.fetch('api/snapshot');
      const data = (await res.json()) as Snapshot;
      setSnapshot(data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    hana.ready();
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await hana.api.fetch('api/refresh', { method: 'POST' });
      const data = (await res.json()) as Snapshot & { ok: boolean };
      setSnapshot(data);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }

  const readings = (snapshot?.readings ?? []).filter((r) => r.status !== 'unconfigured');
  const thresholds = snapshot?.thresholds ?? { warn: 75, critical: 90 };
  const level = overallLevel(readings, thresholds);
  const attention = readings.filter(
    (r) => r.status === 'ok' && r.windows.some((w) => w.usedPercent >= thresholds.warn)
  ).length;

  return (
    <div className="pulse-widget">
      <div className="pulse-header">
        <span className="pulse-title">额度总览</span>
        <span className="pulse-muted pulse-header-summary">
          {readings.length > 0
            ? `${readings.length} 家${attention > 0 ? ` · ${attention} 家需注意` : ''}`
            : '未配置'}
        </span>
      </div>

      {failed && <div className="pulse-sub pulse-text-critical pulse-load-fail">面板数据读取失败，请重试</div>}

      {!failed && readings.length === 0 && (
        <div className="pulse-empty">
          <div className="pulse-empty-title">还没有可监视的服务商</div>
          <div className="pulse-sub">
            已配置 API key 或登录过 Claude Code / Codex CLI 后会自动出现。到 Hana 设置 → 插件 → Pulse 填写 key。
          </div>
        </div>
      )}

      {readings.map((r) => (
        <ProviderCard
          key={r.providerId}
          reading={r}
          thresholds={thresholds}
          expanded={expanded === r.providerId}
          onToggle={() => setExpanded(expanded === r.providerId ? null : r.providerId)}
        />
      ))}

      <div className="pulse-footer">
        <span className="pulse-muted pulse-footer-time">{fmtUpdated(snapshot?.lastPollAt ?? null)}</span>
        <span className="pulse-footer-actions">
          <span className={`pulse-dot pulse-dot-${level}`} style={{ marginRight: 6 }} />
          <button className="pulse-btn" onClick={refresh} disabled={refreshing}>
            {refreshing ? '刷新中' : '刷新'}
          </button>
        </span>
      </div>
    </div>
  );
}

function DiagnosticsView() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryItem[]>([]);

  const load = useCallback(async () => {
    try {
      const [snapRes, discRes] = await Promise.all([
        hana.api.fetch('api/snapshot'),
        hana.api.fetch('api/discovery'),
      ]);
      setSnapshot((await snapRes.json()) as Snapshot);
      setDiscovery(((await discRes.json()) as { discovery: DiscoveryItem[] }).discovery);
    } catch {
      // 诊断页静默失败，保留旧数据
    }
  }, []);

  useEffect(() => {
    hana.ready();
    load();
  }, [load]);

  const cliItems = discovery.filter((d) => d.type === 'cli-file');
  const keyItems = discovery.filter((d) => d.type === 'config-key');
  const readings = snapshot?.readings ?? [];

  return (
    <div className="pulse-page">
      <h2 className="pulse-h2">本机 CLI 凭据</h2>
      <div className="pulse-diag-list">
        {cliItems.map((d) => (
          <div key={d.providerId} className="pulse-diag-item">
            <span className={`pulse-dot ${d.found && d.parsed && !d.expired ? 'pulse-dot-normal' : 'pulse-dot-degraded'}`} />
            <div className="pulse-diag-body">
              <div className="pulse-diag-name">{d.name}</div>
              <div className="pulse-sub pulse-muted">
                {!d.found && `未发现凭据文件（${d.path}）`}
                {d.found && !d.parsed && '凭据文件存在但无法解析'}
                {d.found && d.parsed && d.expired && '凭据已过期，请在 CLI 重新登录'}
                {d.found && d.parsed && !d.expired && `凭据有效 · ${d.path}`}
              </div>
            </div>
          </div>
        ))}
        {cliItems.length === 0 && <div className="pulse-sub pulse-muted">没有可自动发现的 CLI 凭据</div>}
      </div>

      <h2 className="pulse-h2">API key 服务商</h2>
      <div className="pulse-diag-list">
        {keyItems.map((d) => (
          <div key={d.providerId} className="pulse-diag-item">
            <span className={`pulse-dot ${d.configured ? 'pulse-dot-normal' : 'pulse-dot-degraded'}`} />
            <div className="pulse-diag-body">
              <div className="pulse-diag-name">{d.name}</div>
              <div className="pulse-sub pulse-muted">
                {d.configured ? '已配置' : `未配置 · 到 Hana 设置 → 插件 → Pulse 填写 ${d.configKey}`}
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="pulse-h2">最近读数</h2>
      <div className="pulse-diag-list">
        {readings.map((r) => (
          <div key={r.providerId} className="pulse-diag-item">
            <span className={`pulse-dot ${r.status === 'ok' ? 'pulse-dot-normal' : 'pulse-dot-degraded'}`} />
            <div className="pulse-diag-body">
              <div className="pulse-diag-name">
                {r.name}
                {r.plan ? <span className="pulse-muted pulse-plan">{r.plan}</span> : null}
              </div>
              <div className="pulse-sub pulse-muted">
                {r.status === 'ok'
                  ? `正常 · ${fmtUpdated(r.updatedAt)}`
                  : r.status === 'unconfigured'
                    ? '未配置凭据'
                    : (r.error ?? r.status)}
              </div>
            </div>
          </div>
        ))}
        {readings.length === 0 && <div className="pulse-sub pulse-muted">还没有读数</div>}
      </div>

      <div className="pulse-diag-note">
        Pulse 只读取本机凭据与服务商官方接口，请求仅发往插件白名单内的域名，不回传任何数据。
      </div>
    </div>
  );
}

function App() {
  const surface = document.getElementById('root')?.dataset.surface || 'widget';
  return (
    <HanaThemeProvider mode="inherit" className="pulse-root">
      {surface === 'widget' ? <WidgetView /> : <DiagnosticsView />}
    </HanaThemeProvider>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
