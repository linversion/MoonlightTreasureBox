import { useMemo, useRef, useState } from 'react';
import type { AnrVisualizationData, MessageNode } from './lib/anrParser';
import { messageTypeToColor, messageTypeToLabel, parseAnr } from './lib/anrParser';
import './App.css';

function App() {
  const [data, setData] = useState<AnrVisualizationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [hover, setHover] = useState<{ node: MessageNode; x: number; y: number } | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      messageRefs.current = {};
      setHover(null);
      const buffer = await file.arrayBuffer();
      const parsed = parseAnr(buffer);
      setData(parsed);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '解析失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerSelect = () => {
    fileInputRef.current?.click();
  };

  const anrIndex = useMemo(() => {
    if (!data) return -1;
    return data.messages.findIndex((msg) => msg.msgType === 0x04);
  }, [data]);

  const handleLocateAnr = () => {
    if (anrIndex < 0) return;
    const target = messageRefs.current[anrIndex];
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  const handleMouseEnter = (node: MessageNode, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover({ node, x: rect.left + rect.width / 2, y: rect.top });
  };

  return (
    <div className="app">
      <header>
        <h1>ANR 调度可视化</h1>
        <p>
          先在手机上收集 BlockMoonlightTreasureBox 导出的 <code>.anr</code> 文件，点击下方按钮选择文件，网页会解析并还原消息调度过程。
        </p>
        <div className="actions">
          <button onClick={handleTriggerSelect} className="primary">{data ? '重新选择文件' : '选择 ANR 文件'}</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".anr,.dat,application/octet-stream"
            hidden
            onChange={handleFileChange}
          />
          <button onClick={handleLocateAnr} disabled={!data || anrIndex < 0}>
            定位 ANR 节点
          </button>
          {loading && <span className="hint">解析中...</span>}
        </div>
        {error && <div className="error">{error}</div>}
      </header>

      {data ? (
        <main>
          <section className="summary">
            <div>
              <strong>采样时间</strong>
              <span>{data.markTime || '-'}</span>
            </div>
            <div>
              <strong>消息数量</strong>
              <span>{data.messages.length}</span>
            </div>
            <div>
              <strong>调度记录</strong>
              <span>{data.scheduling.length}</span>
            </div>
            <div>
              <strong>CPU</strong>
              <span>{data.cpuInfo || '暂无'}</span>
            </div>
            <div>
              <strong>System Load</strong>
              <span>{data.systemLoad || '暂无'}</span>
            </div>
          </section>

          <section>
            <h2>消息队列调度</h2>
            <div className="timeline" id="message-timeline">
              {data.messages.map((msg, index) => (
                <div
                  key={`${msg.key}-${index}`}
                  className={`message-node${msg.msgType === 0x04 ? ' anr' : ''}`}
                  style={{ backgroundColor: messageTypeToColor(msg.msgType) }}
                  ref={(el) => {
                    messageRefs.current[index] = el;
                  }}
                  onMouseEnter={(e) => handleMouseEnter(msg, e)}
                  onMouseLeave={() => setHover(null)}
                >
                  <span className="msg-index">{index + 1}</span>
                  <span className="msg-type">{messageTypeToLabel(msg.msgType)}</span>
                  <span className="msg-wall">{msg.wallTime}ms</span>
                </div>
              ))}
              {hover && (
                <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
                  <div className="tooltip-title">{messageTypeToLabel(hover.node.msgType)}</div>
                  <div>wall: {hover.node.wallTime}ms / cpu: {hover.node.cpuTime}ms</div>
                  {hover.node.boxMessages[0] && (
                    <div className="tooltip-box">
                      {hover.node.boxMessages[0].handleName}
                      <br />
                      {hover.node.boxMessages[0].callbackName}
                    </div>
                  )}
                  <pre className="tooltip-trace">{data?.mainThreadStack ?? ''}</pre>
                </div>
              )}
            </div>
          </section>

          <section>
            <h2>Handler 调度耗时</h2>
            <div className="timeline scheduling">
              {data.scheduling.map((item) => (
                <div key={item.key} className="scheduling-bar" style={{ width: Math.max(4, item.dealt / 5) }}>
                  <span>{item.dealt}ms · {item.msgId}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="details">
            <div>
              <h3>消息队列快照</h3>
              <pre className="code-block">{data.messageQueueSample || '暂无数据'}</pre>
            </div>
            <div>
              <h3>ANR Trace</h3>
              <pre className="code-block">{data.mainThreadStack || '暂无数据'}</pre>
            </div>
          </section>
        </main>
      ) : (
        <div className="placeholder">
          <p>选择文件后即可开始分析。</p>
        </div>
      )}
    </div>
  );
}

export default App;
