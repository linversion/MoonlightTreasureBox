import { JavaDeserializer } from './javaDeserialization';

export interface BoxMessageInfo {
  handleName?: string;
  handlerAddress?: string;
  callbackName?: string;
  messageWhat?: number;
  msgId?: number;
}

export interface MessageNode {
  key: number;
  msgType: number;
  wallTime: number;
  cpuTime: number;
  count: number;
  createdAt: number;
  boxMessages: BoxMessageInfo[];
}

export interface SchedulingNode {
  key: number;
  dealt: number;
  msgId?: string;
  start: boolean;
}

export interface AnrVisualizationData {
  markTime: string;
  cpuInfo: string;
  systemLoad: string;
  mainThreadStack: string;
  messageQueueSample: string;
  messages: MessageNode[];
  scheduling: SchedulingNode[];
}

export function parseAnr(buffer: ArrayBuffer): AnrVisualizationData {
  const deserializer = new JavaDeserializer();
  const raw = deserializer.deserialize(buffer) as any;
  if (!raw) {
    throw new Error('无法解析ANR文件');
  }
  const messageCache = raw.messageSamplerCache ?? {};
  const schedulingCache = raw.scheduledSamplerCache ?? {};
  return {
    markTime: raw.markTime ?? '',
    cpuInfo: raw.cpuInfo ?? '',
    systemLoad: raw.systemLoad ?? '',
    mainThreadStack: raw.mainThreadStack ?? '',
    messageQueueSample: raw.messageQueueSample ?? '',
    messages: extractMessageNodes(messageCache),
    scheduling: extractSchedulingNodes(schedulingCache),
  };
}

function extractMessageNodes(cache: any): MessageNode[] {
  const entries = cache?.linkedHashMap?.entries ?? [];
  return entries.map((entry: any) => {
    const key = Number(entry?.key ?? 0);
    const value = entry?.value ?? {};
    const boxes = (value.boxMessages?.items ?? []) as BoxMessageInfo[];
    return {
      key,
      msgType: Number(value.msgType ?? 0),
      wallTime: Number(value.wallTime ?? 0),
      cpuTime: Number(value.cpuTime ?? 0),
      count: Number(value.count ?? 0),
      createdAt: Number(value.messageCreateTime ?? 0),
      boxMessages: boxes,
    };
  });
}

function extractSchedulingNodes(cache: any): SchedulingNode[] {
  const entries = cache?.linkedHashMap?.entries ?? [];
  return entries.map((entry: any) => {
    const value = entry?.value ?? {};
    return {
      key: Number(entry?.key ?? 0),
      dealt: Number(value.dealt ?? 0),
      msgId: value.msgId,
      start: Boolean(value.start),
    };
  });
}

export function messageTypeToLabel(msgType: number): string {
  switch (msgType) {
    case 0x00:
      return 'NONE';
    case 0x01:
      return 'INFO';
    case 0x02:
      return 'WARN';
    case 0x04:
      return 'ANR';
    case 0x08:
      return 'JANK';
    case 0x10:
      return 'GAP';
    case 0x20:
      return 'ACTIVITY';
    default:
      return `0x${msgType.toString(16)}`;
  }
}

export function messageTypeToColor(msgType: number): string {
  switch (msgType) {
    case 0x04:
      return '#222';
    case 0x02:
      return '#f79e1b';
    case 0x10:
      return '#7dc4ff';
    case 0x08:
      return '#bc80ea';
    case 0x20:
      return '#4db6ac';
    default:
      return '#f06292';
  }
}
