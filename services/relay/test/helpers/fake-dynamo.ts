import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

type Item = Record<string, unknown>;
type Names = Record<string, string>;
type Values = Record<string, unknown>;

export class FakeDynamoError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

const ReservedKeywords = new Set(['AND', 'OR', 'NOT', 'SET', 'REMOVE', 'ADD', 'DELETE']);
const FUNCTIONS = new Set(['attribute_exists', 'attribute_not_exists', 'if_not_exists']);

interface Tok {
  t: 'name' | 'val' | 'id' | 'op' | 'lp' | 'rp' | 'comma';
  s: string;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '(') {
      out.push({ t: 'lp', s: ch });
      i += 1;
    } else if (ch === ')') {
      out.push({ t: 'rp', s: ch });
      i += 1;
    } else if (ch === ',') {
      out.push({ t: 'comma', s: ch });
      i += 1;
    } else if (ch === '#' || ch === ':') {
      const m = /^[#:][A-Za-z0-9_]+/.exec(src.slice(i));
      if (!m) throw new FakeDynamoError('ValidationException', `bad placeholder in "${src}"`);
      out.push({ t: ch === '#' ? 'name' : 'val', s: m[0] });
      i += m[0].length;
    } else if (/[<>=]/.test(ch)) {
      const two = src.slice(i, i + 2);
      if (two === '<>' || two === '<=' || two === '>=') {
        out.push({ t: 'op', s: two });
        i += 2;
      } else {
        out.push({ t: 'op', s: ch });
        i += 1;
      }
    } else if (ch === '+' || ch === '-') {
      out.push({ t: 'op', s: ch });
      i += 1;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ t: 'id', s: m[0] });
      i += m[0].length;
    } else {
      throw new FakeDynamoError('ValidationException', `unexpected character in expression "${src}"`);
    }
  }
  return out;
}

/** Tracks placeholder usage so unused or undefined placeholders fail like the real service. */
class Scope {
  usedNames = new Set<string>();
  usedValues = new Set<string>();
  constructor(
    readonly names: Names,
    readonly values: Values,
  ) {}
  name(ph: string): string {
    const n = this.names[ph];
    if (n === undefined) throw new FakeDynamoError('ValidationException', `undefined attribute name ${ph}`);
    this.usedNames.add(ph);
    return n;
  }
  value(ph: string): unknown {
    if (!(ph in this.values)) throw new FakeDynamoError('ValidationException', `undefined attribute value ${ph}`);
    this.usedValues.add(ph);
    return this.values[ph];
  }
}

class P {
  i = 0;
  constructor(
    readonly toks: Tok[],
    readonly sc: Scope,
  ) {}
  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  next(): Tok {
    const t = this.toks[this.i];
    if (!t) throw new FakeDynamoError('ValidationException', 'unexpected end of expression');
    this.i += 1;
    return t;
  }
  expect(t: Tok['t'], s?: string): Tok {
    const x = this.next();
    if (x.t !== t || (s !== undefined && x.s !== s)) throw new FakeDynamoError('ValidationException', `expected ${s ?? t}, got ${x.s}`);
    return x;
  }
  atEnd(): boolean {
    return this.i >= this.toks.length;
  }
}

function attrPath(p: P): string {
  return p.sc.name(p.expect('name').s);
}

function operand(p: P, item: Item | undefined): unknown {
  const t = p.next();
  if (t.t === 'val') return p.sc.value(t.s);
  if (t.t === 'name') {
    const attr = p.sc.name(t.s); // resolve first: optional chaining would skip the call when item is undefined
    return item?.[attr];
  }
  if (t.t === 'id' && t.s === 'if_not_exists') {
    p.expect('lp');
    const a = attrPath(p);
    p.expect('comma');
    const dflt = operand(p, item);
    p.expect('rp');
    return item?.[a] !== undefined ? item[a] : dflt;
  }
  throw new FakeDynamoError('ValidationException', `bad operand ${t.s}`);
}

function compare(op: string, a: unknown, b: unknown): boolean {
  if (a === undefined) return op === '<>';
  if (op === '=') return a === b;
  if (op === '<>') return a !== b;
  if (typeof a !== typeof b) return false;
  const x = a as number | string;
  const y = b as number | string;
  switch (op) {
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '>':
      return x > y;
    case '>=':
      return x >= y;
  }
  throw new FakeDynamoError('ValidationException', `bad operator ${op}`);
}

function evalOr(p: P, item: Item | undefined): boolean {
  let v = evalAnd(p, item);
  while (p.peek()?.t === 'id' && p.peek()?.s === 'OR') {
    p.next();
    const r = evalAnd(p, item);
    v = v || r;
  }
  return v;
}
function evalAnd(p: P, item: Item | undefined): boolean {
  let v = evalFactor(p, item);
  while (p.peek()?.t === 'id' && p.peek()?.s === 'AND') {
    p.next();
    const r = evalFactor(p, item);
    v = v && r;
  }
  return v;
}
function evalFactor(p: P, item: Item | undefined): boolean {
  const t = p.peek();
  if (t?.t === 'lp') {
    p.next();
    const v = evalOr(p, item);
    p.expect('rp');
    return v;
  }
  if (t?.t === 'id' && (t.s === 'attribute_exists' || t.s === 'attribute_not_exists')) {
    p.next();
    p.expect('lp');
    const a = attrPath(p);
    p.expect('rp');
    const exists = item !== undefined && item[a] !== undefined;
    return t.s === 'attribute_exists' ? exists : !exists;
  }
  const left = operand(p, item);
  const op = p.expect('op').s;
  const right = operand(p, item);
  return compare(op, left, right);
}

function checkBareIdentifiers(toks: Tok[], expr: string): void {
  for (const t of toks) {
    if (t.t === 'id' && !ReservedKeywords.has(t.s) && !FUNCTIONS.has(t.s)) {
      throw new FakeDynamoError(
        'ValidationException',
        `expression "${expr}" uses the bare identifier ${t.s}; attribute names must be #placeholders`,
      );
    }
  }
}

function evalCondition(expr: string | undefined, item: Item | undefined, sc: Scope): boolean {
  if (!expr) return true;
  const toks = tokenize(expr);
  checkBareIdentifiers(toks, expr);
  const p = new P(toks, sc);
  const v = evalOr(p, item);
  if (!p.atEnd()) throw new FakeDynamoError('ValidationException', `trailing tokens in "${expr}"`);
  return v;
}

interface UpdateOutcome {
  item: Item;
  updated: Set<string>;
}

function applyUpdate(expr: string, current: Item | undefined, key: Item, sc: Scope): UpdateOutcome {
  const toks = tokenize(expr);
  checkBareIdentifiers(toks, expr);
  const p = new P(toks, sc);
  const item: Item = { ...(current ?? key) };
  const original = current ?? key;
  const updated = new Set<string>();
  const seenClauses = new Set<string>();
  const touched = new Set<string>();
  const touch = (a: string): void => {
    if (a in key) throw new FakeDynamoError('ValidationException', `cannot update key attribute ${a}`);
    if (touched.has(a)) throw new FakeDynamoError('ValidationException', `two document paths overlap: ${a}`);
    touched.add(a);
  };
  while (!p.atEnd()) {
    const kw = p.expect('id').s;
    if (kw !== 'SET' && kw !== 'REMOVE' && kw !== 'ADD') throw new FakeDynamoError('ValidationException', `bad clause ${kw}`);
    if (seenClauses.has(kw)) throw new FakeDynamoError('ValidationException', `clause ${kw} given twice`);
    seenClauses.add(kw);
    for (;;) {
      if (kw === 'SET') {
        const a = attrPath(p);
        touch(a);
        p.expect('op', '=');
        let v = operand(p, original);
        if (p.peek()?.t === 'op' && (p.peek()?.s === '+' || p.peek()?.s === '-')) {
          const o = p.next().s;
          const r = operand(p, original);
          if (typeof v !== 'number' || typeof r !== 'number') throw new FakeDynamoError('ValidationException', 'arithmetic on non-number');
          v = o === '+' ? v + r : v - r;
        }
        item[a] = v;
        updated.add(a);
      } else if (kw === 'REMOVE') {
        const a = attrPath(p);
        touch(a);
        delete item[a];
      } else {
        const a = attrPath(p);
        touch(a);
        const v = operand(p, original);
        if (typeof v !== 'number') throw new FakeDynamoError('ValidationException', 'ADD supports numbers and sets only');
        const cur = original[a];
        if (cur !== undefined && typeof cur !== 'number') throw new FakeDynamoError('ValidationException', 'ADD on non-number attribute');
        item[a] = ((cur as number | undefined) ?? 0) + v;
        updated.add(a);
      }
      if (p.peek()?.t === 'comma') {
        p.next();
        continue;
      }
      break;
    }
  }
  return { item, updated };
}

function assertAllPlaceholdersUsed(sc: Scope, names: Names | undefined, values: Values | undefined): void {
  for (const ph of Object.keys(names ?? {})) {
    if (!sc.usedNames.has(ph)) throw new FakeDynamoError('ValidationException', `ExpressionAttributeNames contains unused ${ph}`);
  }
  for (const ph of Object.keys(values ?? {})) {
    if (!sc.usedValues.has(ph)) throw new FakeDynamoError('ValidationException', `ExpressionAttributeValues contains unused ${ph}`);
  }
}

const k = (key: Item): string => `${String(key.pk)}\u0000${String(key.sk)}`;
const failedCondition = (): FakeDynamoError => new FakeDynamoError('ConditionalCheckFailedException', 'The conditional request failed');

interface CommonInput {
  TableName?: string;
  Key?: Item;
  Item?: Item;
  ConditionExpression?: string;
  UpdateExpression?: string;
  FilterExpression?: string;
  ExpressionAttributeNames?: Names;
  ExpressionAttributeValues?: Values;
  ReturnValues?: string;
  ConsistentRead?: boolean;
  ExclusiveStartKey?: Item;
  IndexName?: string;
  KeyConditionExpression?: string;
  Select?: string;
}

/**
 * In-memory stand-in for the DynamoDB document client. It evaluates the exact expression subset the relay
 * uses (attribute_exists/not_exists, comparisons, AND/OR, SET with if_not_exists and +/-, REMOVE, ADD) and is
 * strict like the real service about unused or undefined placeholders and bare (non-placeholder) attribute
 * names. Every call is single-item atomic. It proves the relay's logic and expression shape against a faithful
 * model; it does not prove behaviour of the real service.
 */
export class FakeDynamo {
  readonly items = new Map<string, Item>();
  /** Every call in order. `items` is the number of items of a transaction (a transactional write costs 2 units per item). */
  readonly calls: { op: string; key?: Item; items?: number }[] = [];
  scanPageSize = 2;
  /** The only global secondary index of the real table (sparse, keys gsi1pk and gsi1sk). */
  static readonly INDEXES: Record<string, { pk: string; sk: string }> = { 'live-rooms': { pk: 'gsi1pk', sk: 'gsi1sk' } };
  private faults: { match: (op: string, input: CommonInput) => boolean; error: Error; times: number }[] = [];

  /** Makes matching calls fail with `error` (for `times` calls). */
  injectFault(match: (op: string, input: CommonInput) => boolean, error: Error, times = 1): void {
    this.faults.push({ match, error, times });
  }

  private opOf(command: unknown): string {
    return command instanceof GetCommand
      ? 'get'
      : command instanceof PutCommand
        ? 'put'
        : command instanceof UpdateCommand
          ? 'update'
          : command instanceof DeleteCommand
            ? 'delete'
            : command instanceof ScanCommand
              ? 'scan'
              : command instanceof QueryCommand
                ? 'query'
                : command instanceof TransactWriteCommand
                  ? 'transact'
                  : 'unsupported';
  }

  async send(command: unknown): Promise<unknown> {
    const input = (command as { input: CommonInput }).input;
    const op = this.opOf(command);
    if (op === 'unsupported') throw new FakeDynamoError('ValidationException', 'unsupported command');
    if (op !== 'transact' && !input.TableName) throw new FakeDynamoError('ValidationException', 'TableName is required');
    this.calls.push({
      op,
      ...(input.Key ? { key: input.Key } : input.Item ? { key: { pk: input.Item.pk, sk: input.Item.sk } } : {}),
      ...(op === 'transact' ? { items: ((input as unknown as TransactInput).TransactItems ?? []).length } : {}),
    });
    for (const f of this.faults) {
      if (f.times > 0 && f.match(op, input)) {
        f.times -= 1;
        throw f.error;
      }
    }
    if (op === 'transact') return this.transact(input as unknown as TransactInput);
    return this.exec(op, input);
  }

  /** Executes one single-item operation (also used for the members of a transaction). */
  private exec(op: string, input: CommonInput): unknown {
    switch (op) {
      case 'get': {
        const item = this.items.get(k(input.Key as Item));
        return item ? { Item: structuredClone(item) } : {};
      }
      case 'put': {
        const item = input.Item as Item;
        const sc = new Scope(input.ExpressionAttributeNames ?? {}, input.ExpressionAttributeValues ?? {});
        const cur = this.items.get(k(item));
        if (!evalCondition(input.ConditionExpression, cur, sc)) throw failedCondition();
        assertAllPlaceholdersUsed(sc, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        this.items.set(k(item), structuredClone(item));
        return {};
      }
      case 'delete': {
        const key = input.Key as Item;
        const sc = new Scope(input.ExpressionAttributeNames ?? {}, input.ExpressionAttributeValues ?? {});
        const cur = this.items.get(k(key));
        if (!evalCondition(input.ConditionExpression, cur, sc)) throw failedCondition();
        assertAllPlaceholdersUsed(sc, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        this.items.delete(k(key));
        return input.ReturnValues === 'ALL_OLD' && cur ? { Attributes: structuredClone(cur) } : {};
      }
      case 'update': {
        const key = input.Key as Item;
        const sc = new Scope(input.ExpressionAttributeNames ?? {}, input.ExpressionAttributeValues ?? {});
        const cur = this.items.get(k(key));
        if (!evalCondition(input.ConditionExpression, cur, sc)) throw failedCondition();
        const out = applyUpdate(input.UpdateExpression ?? '', cur, key, sc);
        assertAllPlaceholdersUsed(sc, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        this.items.set(k(key), structuredClone(out.item));
        switch (input.ReturnValues) {
          case 'ALL_OLD':
            return cur ? { Attributes: structuredClone(cur) } : {};
          case 'ALL_NEW':
            return { Attributes: structuredClone(out.item) };
          case 'UPDATED_NEW':
            return { Attributes: Object.fromEntries([...out.updated].map((a) => [a, out.item[a]])) };
          default:
            return {};
        }
      }
      case 'query': {
        const idx = FakeDynamo.INDEXES[input.IndexName ?? ''];
        if (!idx) throw new FakeDynamoError('ValidationException', 'The table does not have the specified index');
        if (!input.KeyConditionExpression) throw new FakeDynamoError('ValidationException', 'KeyConditionExpression is required');
        const sc = new Scope(input.ExpressionAttributeNames ?? {}, input.ExpressionAttributeValues ?? {});
        // a sparse index holds only items that carry both of its key attributes
        const indexed = [...this.items.values()]
          .filter((v) => v[idx.pk] !== undefined && v[idx.sk] !== undefined)
          .sort((a, b) => (a[idx.sk] as number) - (b[idx.sk] as number) || (k(a) < k(b) ? -1 : 1));
        let start = 0;
        if (input.ExclusiveStartKey) start = indexed.findIndex((v) => k(v) === k(input.ExclusiveStartKey as Item)) + 1;
        const page = indexed.slice(start, start + this.scanPageSize);
        const matched = page.filter((v) => evalCondition(input.KeyConditionExpression, v, sc));
        if (page.length === 0) evalCondition(input.KeyConditionExpression, {}, sc);
        assertAllPlaceholdersUsed(sc, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        const more = start + this.scanPageSize < indexed.length;
        const last = page.at(-1);
        const base = {
          ...(more && last ? { LastEvaluatedKey: { pk: last.pk, sk: last.sk } } : {}),
        };
        if (input.Select === 'COUNT') return { Count: matched.length, ...base };
        return { Items: matched.map((v) => structuredClone(v)), Count: matched.length, ...base };
      }
      default: {
        // scan, with pagination to exercise LastEvaluatedKey handling
        const sc = new Scope(input.ExpressionAttributeNames ?? {}, input.ExpressionAttributeValues ?? {});
        const all = [...this.items.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
        let start = 0;
        if (input.ExclusiveStartKey) {
          const idx = all.findIndex(([key]) => key === k(input.ExclusiveStartKey as Item));
          start = idx + 1;
        }
        const page = all.slice(start, start + this.scanPageSize);
        const matched = page.map(([, v]) => v).filter((v) => evalCondition(input.FilterExpression, v, sc));
        // placeholders must be used even if the page is empty
        if (input.FilterExpression && page.length === 0) evalCondition(input.FilterExpression, {}, sc);
        assertAllPlaceholdersUsed(sc, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        const more = start + this.scanPageSize < all.length;
        const last = page.at(-1);
        return {
          Items: matched.map((v) => structuredClone(v)),
          ...(more && last ? { LastEvaluatedKey: { pk: last[1].pk, sk: last[1].sk } } : {}),
        };
      }
    }
  }

  /**
   * TransactWriteItems: every condition is evaluated against the state before the transaction; if any fails nothing is
   * written and TransactionCanceledException carries one reason per item, as the real service does. Two operations on
   * one item are refused, as the real service refuses them.
   */
  private transact(input: TransactInput): unknown {
    const ops = input.TransactItems.map((t) => {
      const entry = t.Put ? ['put', t.Put] : t.Update ? ['update', t.Update] : t.Delete ? ['delete', t.Delete] : t.ConditionCheck ? ['check', t.ConditionCheck] : null;
      if (!entry) throw new FakeDynamoError('ValidationException', 'transaction item without an operation');
      return { op: entry[0] as string, input: entry[1] as CommonInput };
    });
    if (ops.length === 0 || ops.length > 100) throw new FakeDynamoError('ValidationException', 'a transaction has 1 to 100 items');
    const keys = ops.map((o) => k(o.op === 'put' ? (o.input.Item as Item) : (o.input.Key as Item)));
    if (new Set(keys).size !== keys.length) {
      throw new FakeDynamoError('ValidationException', 'Transaction request cannot include multiple operations on one item');
    }
    const reasons = ops.map((o, i) => {
      const cur = this.items.get(keys[i] as string);
      const sc = new Scope(o.input.ExpressionAttributeNames ?? {}, o.input.ExpressionAttributeValues ?? {});
      const ok = evalCondition(o.input.ConditionExpression, cur, sc);
      return { Code: ok ? 'None' : 'ConditionalCheckFailed' };
    });
    if (reasons.some((r) => r.Code !== 'None')) {
      const e = new FakeDynamoError('TransactionCanceledException', 'Transaction cancelled, please refer cancellation reasons for specific reasons');
      (e as unknown as { CancellationReasons: unknown }).CancellationReasons = reasons;
      throw e;
    }
    for (const o of ops) if (o.op !== 'check') this.exec(o.op, o.input);
    return {};
  }
}

interface TransactInput {
  TransactItems: { Put?: CommonInput; Update?: CommonInput; Delete?: CommonInput; ConditionCheck?: CommonInput }[];
}
