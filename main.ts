// Tiny stack VM (ISA v1) for make.fun tiny-stack-vm-01-run-20261122.
// Runs every /input/<id>/program.bin with its input.bin and writes
// /output/<id>/stdout.bin + exit.txt. Node 22, erasable syntax only.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STACK_MAX = 256;
const CALL_MAX = 64;
const STEP_LIMIT = 1_000_000;
const OUTPUT_MAX = 65_536;

// [opcode, immediate bytes, pops, pushes] for every defined opcode.
const SPEC: Array<readonly [number, number, number, number]> = [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1], [0x03, 0, 1, 0],
  [0x04, 0, 1, 2], [0x05, 0, 2, 2], [0x06, 0, 2, 3], [0x07, 0, 3, 3],
  [0x10, 0, 2, 1], [0x11, 0, 2, 1], [0x12, 0, 2, 1], [0x13, 0, 2, 1],
  [0x14, 0, 2, 1], [0x15, 0, 2, 1], [0x16, 0, 2, 1], [0x17, 0, 1, 1],
  [0x18, 0, 2, 1], [0x19, 0, 2, 1], [0x1a, 0, 2, 1], [0x1b, 0, 1, 1],
  [0x1c, 0, 2, 1], [0x1d, 0, 2, 1], [0x1e, 0, 2, 1], [0x20, 0, 2, 1],
  [0x21, 0, 2, 1], [0x22, 0, 2, 1], [0x30, 2, 0, 0], [0x31, 2, 1, 0],
  [0x32, 2, 1, 0], [0x33, 2, 0, 0], [0x34, 0, 0, 0], [0x40, 0, 1, 1],
  [0x41, 0, 2, 0], [0x50, 0, 1, 0], [0x51, 0, 1, 0], [0x52, 0, 0, 1],
  [0x53, 0, 1, 0],
];
const IMM = new Int8Array(256).fill(-1);
const POPS = new Int8Array(256);
const PUSH = new Int8Array(256);
for (const [op, imm, pops, push] of SPEC) {
  IMM[op] = imm;
  POPS[op] = pops;
  PUSH[op] = push;
}

// Runs one program to its end: the bytes it wrote and its exit code
// (0-255; a trap's code when it traps, output kept up to the trap).
function run(program: Uint8Array, input: Uint8Array): { out: Uint8Array; exit: number } {
  const n = program.length;
  const st = new Int32Array(STACK_MAX);
  let sp = 0;
  const cs = new Int32Array(CALL_MAX);
  let cp = 0;
  const mem = new Int32Array(256);
  const out = new Uint8Array(OUTPUT_MAX);
  let olen = 0;
  let ipos = 0;
  let pc = 0;
  let steps = 0;
  const end = (exit: number): { out: Uint8Array; exit: number } => ({
    out: out.subarray(0, olen),
    exit,
  });
  for (;;) {
    if (steps === STEP_LIMIT) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = program[pc];
    const imm = IMM[op];
    if (imm < 0) return end(5);
    if (pc + imm >= n) return end(9);
    steps++;
    const pops = POPS[op];
    if (sp < pops) return end(2);
    if (sp - pops + PUSH[op] > STACK_MAX) return end(3);
    const next = pc + 1 + imm;
    pc = next;
    switch (op) {
      case 0x00:
        return end(0);
      case 0x01:
        st[sp++] = (program[next - 1] << 24) >> 24;
        break;
      case 0x02:
        st[sp++] =
          program[next - 4] |
          (program[next - 3] << 8) |
          (program[next - 2] << 16) |
          (program[next - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04:
        st[sp] = st[sp - 1];
        sp++;
        break;
      case 0x05: {
        const t = st[sp - 1];
        st[sp - 1] = st[sp - 2];
        st[sp - 2] = t;
        break;
      }
      case 0x06:
        st[sp] = st[sp - 2];
        sp++;
        break;
      case 0x07: {
        const a = st[sp - 3];
        st[sp - 3] = st[sp - 2];
        st[sp - 2] = st[sp - 1];
        st[sp - 1] = a;
        break;
      }
      case 0x10:
      case 0x11:
      case 0x12:
      case 0x13:
      case 0x14:
      case 0x15:
      case 0x16:
      case 0x18:
      case 0x19:
      case 0x1a:
      case 0x1c:
      case 0x1d:
      case 0x1e:
      case 0x20:
      case 0x21:
      case 0x22: {
        const b = st[sp - 1];
        const a = st[sp - 2];
        let r = 0;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) return end(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) {
          if (b === 0) return end(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) return end(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return end(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        st[sp++] = r;
        break;
      }
      case 0x17:
        st[sp - 1] = -st[sp - 1] | 0;
        break;
      case 0x1b:
        st[sp - 1] = ~st[sp - 1];
        break;
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((program[next - 2] | (program[next - 1] << 8)) << 16) >> 16;
        if (op === 0x30) {
          pc = next + rel;
        } else {
          const v = st[--sp];
          if ((op === 0x31 && v === 0) || (op === 0x32 && v !== 0)) pc = next + rel;
        }
        break;
      }
      case 0x33:
        if (cp === CALL_MAX) return end(7);
        cs[cp++] = next;
        pc = program[next - 2] | (program[next - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return end(8);
        pc = cs[--cp];
        break;
      case 0x40: {
        const addr = st[sp - 1];
        if (addr < 0 || addr >= 256) return end(6);
        st[sp - 1] = mem[addr];
        break;
      }
      case 0x41: {
        const addr = st[sp - 1];
        if (addr < 0 || addr >= 256) return end(6);
        mem[addr] = st[sp - 2];
        sp -= 2;
        break;
      }
      case 0x50: {
        const s = String(st[sp - 1]);
        if (olen + s.length > OUTPUT_MAX) return end(11);
        for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
        sp--;
        break;
      }
      case 0x51:
        if (olen + 1 > OUTPUT_MAX) return end(11);
        out[olen++] = st[--sp] & 255;
        break;
      case 0x52:
        st[sp++] = ipos < input.length ? input[ipos++] : -1;
        break;
      case 0x53:
        return end(st[--sp] & 255);
    }
  }
}

function readInput(p: string): Uint8Array {
  try {
    return readFileSync(p);
  } catch {
    return new Uint8Array(0);
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(readFileSync(join(I, id, 'program.bin')), readInput(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.exit}\n`);
}
