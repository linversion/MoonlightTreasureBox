/*
 * Minimal Java serialization parser tailored for the BlockMoonlightTreasureBox ANR files.
 * It only implements the subset of the specification that appears in the captured data.
 */

const TAG = {
  TC_NULL: 0x70,
  TC_REFERENCE: 0x71,
  TC_CLASSDESC: 0x72,
  TC_OBJECT: 0x73,
  TC_STRING: 0x74,
  TC_ARRAY: 0x75,
  TC_CLASS: 0x76,
  TC_BLOCKDATA: 0x77,
  TC_ENDBLOCKDATA: 0x78,
  TC_RESET: 0x79,
  TC_BLOCKDATALONG: 0x7a,
  TC_EXCEPTION: 0x7b,
  TC_LONGSTRING: 0x7c,
} as const;

const SC_WRITE_METHOD = 0x01;

interface FieldDesc {
  typeCode: string;
  name: string;
  className?: string;
}

interface ClassDesc {
  name: string;
  serialVersionUID: bigint;
  flags: number;
  fields: FieldDesc[];
  superClass?: ClassDesc | null;
}

export type AnnotationSegment =
  | { type: 'block'; data: Uint8Array }
  | { type: 'object'; value: any };

interface ObjectData {
  className: string;
  fields: Record<string, any>;
  annotations: Map<string, AnnotationSegment[]>;
}

class ByteReader {
  private view: DataView;
  private offset = 0;
  private buffer: ArrayBuffer;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
  }

  readUint8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readInt8(): number {
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16(): number {
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readInt16(): number {
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readInt32(): number {
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readUint32(): number {
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readFloat32(): number {
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readFloat64(): number {
    const value = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return value;
  }

  readInt64(): number {
    const high = this.view.getInt32(this.offset, false);
    const low = this.view.getUint32(this.offset + 4, false);
    this.offset += 8;
    return Number((BigInt(high) << 32n) | BigInt(low));
  }

  readBytes(length: number): Uint8Array {
    const slice = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    return new Uint8Array(slice);
  }

  skip(length: number) {
    this.offset += length;
  }
}

function decodeModifiedUtf8(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if ((c & 0x80) === 0) {
      if (c === 0) {
        result += '\u0000';
      } else {
        result += String.fromCharCode(c);
      }
    } else if ((c & 0xe0) === 0xc0) {
      const c2 = bytes[++i];
      const charCode = ((c & 0x1f) << 6) | (c2 & 0x3f);
      result += String.fromCharCode(charCode);
    } else if ((c & 0xf0) === 0xe0) {
      const c2 = bytes[++i];
      const c3 = bytes[++i];
      const charCode = ((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f);
      result += String.fromCharCode(charCode);
    } else {
      throw new Error('Unsupported modified UTF-8 sequence');
    }
  }
  return result;
}

export class JavaDeserializer {
  private reader!: ByteReader;
  private handles = new Map<number, any>();
  private nextHandle = 0x7e0000;

  deserialize(buffer: ArrayBuffer): any {
    this.reader = new ByteReader(buffer);
    this.handles.clear();
    this.nextHandle = 0x7e0000;
    const magic = this.reader.readUint16();
    if (magic !== 0xaced) {
      throw new Error('Invalid stream magic');
    }
    this.reader.readUint16(); // version
    return this.readContentElement();
  }

  private assignHandle(value: any): number {
    const handle = this.nextHandle++;
    this.handles.set(handle, value);
    return handle;
  }

  private setHandle(handle: number, value: any) {
    this.handles.set(handle, value);
  }

  private readContentElement(forcedTag?: number): any {
    const tag = forcedTag ?? this.reader.readUint8();
    switch (tag) {
      case TAG.TC_NULL:
        return null;
      case TAG.TC_REFERENCE: {
        const handle = this.reader.readInt32();
        if (!this.handles.has(handle)) {
          throw new Error(`Unknown handle ${handle.toString(16)}`);
        }
        return this.handles.get(handle);
      }
      case TAG.TC_OBJECT:
        return this.readNewObject();
      case TAG.TC_STRING:
        return this.readNewString();
      case TAG.TC_LONGSTRING:
        return this.readNewLongString();
      case TAG.TC_ARRAY:
        return this.readNewArray();
      case TAG.TC_CLASSDESC:
        return this.readClassDescForTag(tag);
      case TAG.TC_CLASS:
        return this.readClass();
      default:
        throw new Error(`Unsupported tag 0x${tag.toString(16)}`);
    }
  }

  private readClass(): ClassDesc {
    const desc = this.readClassDesc();
    this.assignHandle({ classDesc: desc });
    return desc;
  }

  private readClassDesc(): ClassDesc {
    const tag = this.reader.readUint8();
    return this.readClassDescForTag(tag);
  }

  private readClassDescForTag(tag: number): ClassDesc {
    if (tag === TAG.TC_NULL) {
      return null as unknown as ClassDesc;
    }
    if (tag === TAG.TC_REFERENCE) {
      const handle = this.reader.readInt32();
      return this.handles.get(handle);
    }
    if (tag !== TAG.TC_CLASSDESC) {
      throw new Error(`Unexpected classdesc tag ${tag.toString(16)}`);
    }
    const name = this.readUtfString();
    const serialHigh = this.reader.readInt32();
    const serialLow = this.reader.readUint32();
    const serialVersionUID = (BigInt(serialHigh) << 32n) | BigInt(serialLow);
    const flags = this.reader.readUint8();
    const fieldCount = this.reader.readUint16();
    const fields: FieldDesc[] = [];
    for (let i = 0; i < fieldCount; i++) {
      const typeCode = String.fromCharCode(this.reader.readUint8());
      const fieldName = this.readUtfString();
      let className: string | undefined;
      if (typeCode === 'L' || typeCode === '[') {
        className = this.readUtfString();
      }
      fields.push({ typeCode, name: fieldName, className });
    }
    this.skipClassAnnotations();
    const superClass = this.readClassDesc();
    const desc: ClassDesc = {
      name,
      serialVersionUID,
      flags,
      fields,
      superClass,
    };
    this.assignHandle(desc);
    return desc;
  }

  private skipClassAnnotations() {
    while (true) {
      const tag = this.reader.readUint8();
      if (tag === TAG.TC_ENDBLOCKDATA) {
        return;
      }
      if (tag === TAG.TC_BLOCKDATA) {
        const len = this.reader.readUint8();
        this.reader.skip(len);
      } else if (tag === TAG.TC_BLOCKDATALONG) {
        const len = this.reader.readInt32();
        this.reader.skip(len);
      } else {
        this.readContentElement(tag);
      }
    }
  }

  private readNewObject(): any {
    const classDesc = this.readClassDesc();
    if (!classDesc) {
      throw new Error('Missing class descriptor');
    }
    const placeholder: ObjectData = {
      className: classDesc?.name ?? 'unknown',
      fields: {},
      annotations: new Map(),
    };
    const handle = this.assignHandle(placeholder);
    this.readClassData(classDesc, placeholder.fields, placeholder.annotations);
    const value = this.materializeObject(placeholder);
    this.setHandle(handle, value);
    return value;
  }

  private readClassData(desc: ClassDesc | null, storage: Record<string, any>, annotations: Map<string, AnnotationSegment[]>) {
    if (!desc) {
      return;
    }
    if (desc.superClass) {
      this.readClassData(desc.superClass, storage, annotations);
    }
    for (const field of desc.fields) {
      storage[field.name] = this.readFieldValue(field);
    }
    if ((desc.flags & SC_WRITE_METHOD) !== 0) {
      annotations.set(desc.name, this.readAnnotationSegments());
    }
  }

  private readFieldValue(field: FieldDesc): any {
    switch (field.typeCode) {
      case 'B':
        return this.reader.readInt8();
      case 'C':
        return String.fromCharCode(this.reader.readUint16());
      case 'D':
        return this.reader.readFloat64();
      case 'F':
        return this.reader.readFloat32();
      case 'I':
        return this.reader.readInt32();
      case 'J':
        return this.reader.readInt64();
      case 'S':
        return this.reader.readInt16();
      case 'Z':
        return this.reader.readUint8() !== 0;
      case 'L':
      case '[':
        return this.readContentElement();
      default:
        throw new Error(`Unsupported field type ${field.typeCode}`);
    }
  }

  private readAnnotationSegments(): AnnotationSegment[] {
    const segments: AnnotationSegment[] = [];
    while (true) {
      const tag = this.reader.readUint8();
      if (tag === TAG.TC_ENDBLOCKDATA) {
        break;
      }
      if (tag === TAG.TC_BLOCKDATA) {
        const len = this.reader.readUint8();
        segments.push({ type: 'block', data: this.reader.readBytes(len) });
      } else if (tag === TAG.TC_BLOCKDATALONG) {
        const len = this.reader.readInt32();
        segments.push({ type: 'block', data: this.reader.readBytes(len) });
      } else {
        const value = this.readContentElement(tag);
        segments.push({ type: 'object', value });
      }
    }
    return segments;
  }

  private readNewArray(): any {
    const classDesc = this.readClassDesc();
    const length = this.reader.readInt32();
    const values: any[] = new Array(length);
    if (classDesc?.name?.startsWith('[L') || classDesc?.name?.startsWith('[[')) {
      for (let i = 0; i < length; i++) {
        values[i] = this.readContentElement();
      }
    } else {
      const component = classDesc?.name?.charAt(1);
      switch (component) {
        case 'I':
          for (let i = 0; i < length; i++) values[i] = this.reader.readInt32();
          break;
        case 'J':
          for (let i = 0; i < length; i++) values[i] = this.reader.readInt64();
          break;
        case 'F':
          for (let i = 0; i < length; i++) values[i] = this.reader.readFloat32();
          break;
        case 'D':
          for (let i = 0; i < length; i++) values[i] = this.reader.readFloat64();
          break;
        case 'B':
          for (let i = 0; i < length; i++) values[i] = this.reader.readInt8();
          break;
        case 'S':
          for (let i = 0; i < length; i++) values[i] = this.reader.readInt16();
          break;
        default:
          throw new Error(`Unsupported array component ${component}`);
      }
    }
    this.assignHandle(values);
    return values;
  }

  private readNewString(): string {
    const length = this.reader.readUint16();
    const bytes = this.reader.readBytes(length);
    const str = decodeModifiedUtf8(bytes);
    this.assignHandle(str);
    return str;
  }

  private readNewLongString(): string {
    const high = this.reader.readInt32();
    const low = this.reader.readUint32();
    const length = Number((BigInt(high) << 32n) | BigInt(low));
    const bytes = this.reader.readBytes(length);
    const str = decodeModifiedUtf8(bytes);
    this.assignHandle(str);
    return str;
  }

  private readUtfString(): string {
    const length = this.reader.readUint16();
    const bytes = this.reader.readBytes(length);
    return decodeModifiedUtf8(bytes);
  }

  private materializeObject(data: ObjectData): any {
    const annotations = data.annotations;
    const fields = data.fields;
    const name = data.className;
    switch (name) {
      case 'com.txl.blockmoonlighttreasurebox.info.AnrInfo':
        return {
          cpuInfo: fields['cpuInfo'] ?? '',
          mainThreadStack: fields['mainThreadStack'] ?? '',
          markTime: fields['markTime'] ?? '',
          messageQueueSample: fields['messageQueueSample'] ?? '',
          messageSamplerCache: fields['messageSamplerCache'] ?? null,
          scheduledSamplerCache: fields['scheduledSamplerCache'] ?? null,
          systemLoad: fields['systemLoad'] ?? '',
        };
      case 'com.txl.blockmoonlighttreasurebox.cache.TimeLruCache':
        return {
          offsetTime: Number(fields['offsetTime'] ?? 0),
          lastPutTime: Number(fields['lastPutTime'] ?? 0),
          lastValue: fields['lastValue'] ?? null,
          linkedHashMap: fields['linkedHashMap'] ?? null,
        };
      case 'com.txl.blockmoonlighttreasurebox.info.MessageInfo':
        return {
          msgType: fields['msgType'],
          count: fields['count'],
          wallTime: fields['wallTime'],
          cpuTime: fields['cpuTime'],
          boxMessages: fields['boxMessages'] ?? { items: [] },
          messageCreateTime: fields['messageCreateTime'],
        };
      case 'com.txl.blockmoonlighttreasurebox.info.BoxMessage':
        return {
          handleName: fields['handleName'],
          handlerAddress: fields['handlerAddress'],
          callbackName: fields['callbackName'],
          messageWhat: fields['messageWhat'],
          msgId: fields['msgId'],
        };
      case 'com.txl.blockmoonlighttreasurebox.info.ScheduledInfo':
        return {
          dealt: fields['dealt'],
          msgId: fields['msgId'],
          start: fields['start'],
        };
      case 'java.util.ArrayList':
        return this.materializeArrayList(annotations.get('java.util.ArrayList') ?? annotations.get(name));
      case 'java.util.LinkedHashMap':
      case 'com.txl.blockmoonlighttreasurebox.cache.TimeLruCache$TimeLinkedHashMap':
        return this.materializeLinkedHashMap(annotations.get('java.util.LinkedHashMap') ?? annotations.get(name));
      case 'java.lang.StringBuilder':
        return this.materializeStringBuilder(annotations.get('java.lang.StringBuilder') ?? annotations.get(name));
      case 'java.lang.Long':
        return Number(fields['value']);
      case 'java.lang.Integer':
        return Number(fields['value']);
      case 'java.lang.Boolean':
        return Boolean(fields['value']);
      default:
        return { __className: name, fields };
    }
  }

  private materializeArrayList(segments?: AnnotationSegment[]) {
    const values: any[] = [];
    if (!segments) {
      return { items: values };
    }
    let expected = 0;
    for (const seg of segments) {
      if (seg.type === 'block' && seg.data.length >= 4) {
        const view = new DataView(seg.data.buffer, seg.data.byteOffset, seg.data.byteLength);
        expected = view.getInt32(0, false);
      } else if (seg.type === 'object') {
        values.push(seg.value);
      }
    }
    if (expected > 0 && values.length > expected) {
      values.length = expected;
    }
    return { items: values };
  }

  private materializeLinkedHashMap(segments?: AnnotationSegment[]) {
    const entries: Array<{ key: any; value: any }> = [];
    if (!segments) {
      return { entries };
    }
    let count = 0;
    const collected: any[] = [];
    for (const seg of segments) {
      if (seg.type === 'block' && seg.data.length >= 4) {
        const view = new DataView(seg.data.buffer, seg.data.byteOffset, seg.data.byteLength);
        count = view.getInt32(0, false);
      } else if (seg.type === 'object') {
        collected.push(seg.value);
      }
    }
    for (let i = 0; i < count; i++) {
      const key = collected[i * 2] ?? null;
      const value = collected[i * 2 + 1] ?? null;
      entries.push({ key, value });
    }
    return { entries };
  }

  private materializeStringBuilder(segments?: AnnotationSegment[]): string {
    if (!segments) {
      return '';
    }
    for (const seg of segments) {
      if (seg.type === 'object' && typeof seg.value === 'string') {
        return seg.value;
      }
    }
    return '';
  }
}

