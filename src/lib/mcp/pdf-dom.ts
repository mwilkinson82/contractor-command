// pdf.js legacy evaluates `new DOMMatrix()` while the module loads. The edge
// runtime has no @napi-rs/canvas, so that name is missing unless we install one first.

type MatrixLike = { a: number; b: number; c: number; d: number; e: number; f: number };

class EdgeDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  is2D = true;

  constructor(init?: unknown) {
    if (init == null) return;
    if (typeof init === "object" && "a" in init && typeof (init as MatrixLike).a === "number") {
      const m = init as MatrixLike;
      this.a = m.a;
      this.b = m.b;
      this.c = m.c;
      this.d = m.d;
      this.e = m.e;
      this.f = m.f;
      return;
    }
    const list = arrayLike(init);
    if (!list) return;
    if (list.length === 6) {
      this.a = list[0];
      this.b = list[1];
      this.c = list[2];
      this.d = list[3];
      this.e = list[4];
      this.f = list[5];
    } else if (list.length === 16) {
      this.a = list[0];
      this.b = list[1];
      this.c = list[4];
      this.d = list[5];
      this.e = list[12];
      this.f = list[13];
    }
  }

  multiply(other: MatrixLike): EdgeDOMMatrix {
    return new EdgeDOMMatrix(this).multiplySelf(other);
  }

  multiplySelf(other: MatrixLike): this {
    const a = this.a * other.a + this.c * other.b;
    const b = this.b * other.a + this.d * other.b;
    const c = this.a * other.c + this.c * other.d;
    const d = this.b * other.c + this.d * other.d;
    const e = this.a * other.e + this.c * other.f + this.e;
    const f = this.b * other.e + this.d * other.f + this.f;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  preMultiplySelf(other: MatrixLike): this {
    const a = other.a * this.a + other.c * this.b;
    const b = other.b * this.a + other.d * this.b;
    const c = other.a * this.c + other.c * this.d;
    const d = other.b * this.c + other.d * this.d;
    const e = other.a * this.e + other.c * this.f + other.e;
    const f = other.b * this.e + other.d * this.f + other.f;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  translate(tx = 0, ty = 0): EdgeDOMMatrix {
    return new EdgeDOMMatrix(this).translateSelf(tx, ty);
  }

  translateSelf(tx = 0, ty = 0): this {
    this.e += tx * this.a + ty * this.c;
    this.f += tx * this.b + ty * this.d;
    return this;
  }

  scale(scaleX = 1, scaleY = scaleX): EdgeDOMMatrix {
    return new EdgeDOMMatrix(this).scaleSelf(scaleX, scaleY);
  }

  scaleSelf(scaleX = 1, scaleY = scaleX): this {
    this.a *= scaleX;
    this.b *= scaleX;
    this.c *= scaleY;
    this.d *= scaleY;
    return this;
  }

  inverse(): EdgeDOMMatrix {
    return new EdgeDOMMatrix(this).invertSelf();
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (!det) return this;
    const a = this.d / det;
    const b = -this.b / det;
    const c = -this.c / det;
    const d = this.a / det;
    const e = (this.c * this.f - this.d * this.e) / det;
    const f = (this.b * this.e - this.a * this.f) / det;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  transformPoint(point: { x: number; y: number }): { x: number; y: number; z: number; w: number } {
    return {
      x: point.x * this.a + point.y * this.c + this.e,
      y: point.x * this.b + point.y * this.d + this.f,
      z: 0,
      w: 1,
    };
  }
}

function arrayLike(value: unknown): number[] | null {
  if (typeof value !== "object" || value === null || !("length" in value)) return null;
  const list = Array.from(value as ArrayLike<number>);
  return list.every((n) => typeof n === "number") ? list : null;
}

/** Install a 2D DOMMatrix only when the runtime has none. */
export function installPdfDom(): void {
  const scope = globalThis as { DOMMatrix?: unknown };
  if (typeof scope.DOMMatrix === "function") return;
  scope.DOMMatrix = EdgeDOMMatrix;
}
