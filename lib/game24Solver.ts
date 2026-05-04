type Operator = "+" | "-" | "*" | "/";

interface Expression {
  value: number;
  toString: () => string;
}

class NumberExpr implements Expression {
  constructor(public value: number) {}
  toString() { return this.value.toString(); }
}

class BinaryExpr implements Expression {
  constructor(
    public left: Expression,
    public op: Operator,
    public right: Expression,
    public value: number
  ) {}

  toString(): string {
    const l: string = this.left instanceof BinaryExpr ? `(${this.left.toString()})` : this.left.toString();
    const r: string = this.right instanceof BinaryExpr ? `(${this.right.toString()})` : this.right.toString();
    const opChar = this.op === "*" ? "×" : this.op === "/" ? "÷" : this.op;
    return `${l} ${opChar} ${r}`;
  }
}

export function solve24(numbers: number[]): string | null {
  const exprs = numbers.map(n => new NumberExpr(n));
  return findSolution(exprs);
}

function findSolution(exprs: Expression[]): string | null {
  if (exprs.length === 1) {
    if (Math.abs(exprs[0].value - 24) < 1e-6) {
      return exprs[0].toString();
    }
    return null;
  }

  for (let i = 0; i < exprs.length; i++) {
    for (let j = 0; j < exprs.length; j++) {
      if (i === j) continue;

      const a = exprs[i];
      const b = exprs[j];
      const nextExprs = exprs.filter((_, idx) => idx !== i && idx !== j);

      const ops: Operator[] = ["+", "-", "*", "/"];
      for (const op of ops) {
        let val: number;
        if (op === "+") val = a.value + b.value;
        else if (op === "-") val = a.value - b.value;
        else if (op === "*") val = a.value * b.value;
        else {
          if (Math.abs(b.value) < 1e-6) continue;
          val = a.value / b.value;
        }

        const res = findSolution([...nextExprs, new BinaryExpr(a, op, b, val)]);
        if (res) return res;
      }
    }
  }

  return null;
}

export function getHint(numbers: number[]): string | null {
  const exprs = numbers.map(n => new NumberExpr(n));
  return findHint(exprs);
}

function findHint(exprs: Expression[]): string | null {
  if (exprs.length <= 1) return null;

  for (let i = 0; i < exprs.length; i++) {
    for (let j = 0; j < exprs.length; j++) {
      if (i === j) continue;

      const a = exprs[i];
      const b = exprs[j];
      const nextExprs = exprs.filter((_, idx) => idx !== i && idx !== j);

      const ops: Operator[] = ["+", "-", "*", "/"];
      for (const op of ops) {
        let val: number;
        if (op === "+") val = a.value + b.value;
        else if (op === "-") val = a.value - b.value;
        else if (op === "*") val = a.value * b.value;
        else {
          if (Math.abs(b.value) < 1e-6) continue;
          val = a.value / b.value;
        }

        const combined = new BinaryExpr(a, op, b, val);
        if (findSolution([...nextExprs, combined])) {
          const opChar = op === "*" ? "×" : op === "/" ? "÷" : op;
          return `Try ${a.value} ${opChar} ${b.value} first`;
        }
      }
    }
  }

  return null;
}
