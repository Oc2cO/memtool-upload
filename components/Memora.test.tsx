/**
 * Task #344 — guards the Memora swap so a regression to the legacy
 * yellow-blob MemCharacter can't slip through.
 */

import fs from "fs";
import path from "path";

import React from "react";
import { Image } from "react-native";
import { render } from "@testing-library/react-native";

import { Memora, MemCharacter, type MemExpression } from "@/components/Memora";
import { MemCharacter as ReExportedMemCharacter } from "@/components/MemCharacter";

const SPRITE_SOURCES = {
  calm: require("@/assets/brand/memora-expr-calm.png"),
  smile: require("@/assets/brand/memora-expr-smile.png"),
  thinking: require("@/assets/brand/memora-expr-thinking.png"),
  proud: require("@/assets/brand/memora-expr-proud.png"),
  listening: require("@/assets/brand/memora-expr-listening.png"),
  aha: require("@/assets/brand/memora-expr-aha.png"),
} as const;

type SpriteKey = keyof typeof SPRITE_SOURCES;

const EXPRESSION_FOR_SPRITE: Record<SpriteKey, MemExpression> = {
  calm: "calm",
  smile: "happy",
  thinking: "thinking",
  proud: "celebrate",
  listening: "anxious",
  aha: "curious",
};

function getImageSource(tree: ReturnType<typeof render>) {
  return (tree.UNSAFE_getByType(Image).props as { source: unknown }).source;
}

describe("Memora — photo-real sprite wiring (Task #344)", () => {
  (Object.keys(EXPRESSION_FOR_SPRITE) as SpriteKey[]).forEach((sprite) => {
    const expression = EXPRESSION_FOR_SPRITE[sprite];

    it(`renders the '${sprite}' photo-real PNG for expression='${expression}'`, () => {
      const tree = render(<Memora expression={expression} />);
      expect(getImageSource(tree)).toBe(SPRITE_SOURCES[sprite]);
    });
  });

  it("snapshots the resolved source require for every supported expression", () => {
    const observed: Record<string, unknown> = {};
    for (const sprite of Object.keys(EXPRESSION_FOR_SPRITE) as SpriteKey[]) {
      const expression = EXPRESSION_FOR_SPRITE[sprite];
      const tree = render(<Memora expression={expression} />);
      observed[expression] = getImageSource(tree);
      tree.unmount();
    }
    expect(observed).toMatchInlineSnapshot(`
{
  "anxious": {
    "testUri": "../../../../../../artifacts/memtool/assets/brand/memora-expr-listening.png",
  },
  "calm": {
    "testUri": "../../../../../../artifacts/memtool/assets/brand/memora-expr-calm.png",
  },
  "celebrate": {
    "testUri": "../../../../../../artifacts/memtool/assets/brand/memora-expr-proud.png",
  },
  "curious": {
    "testUri": "../../../../../../artifacts/memtool/assets/brand/memora-expr-aha.png",
  },
  "happy": {
    "testUri": "../../../../../../artifacts/memtool/assets/brand/memora-expr-smile.png",
  },
  "thinking": {
    "testUri": "../../../../../../artifacts/memtool/assets/brand/memora-expr-thinking.png",
  },
}
`);
  });
});

describe("MemCharacter — re-export guard (Task #344)", () => {
  it("MemCharacter is the same function as Memora", () => {
    expect(ReExportedMemCharacter).toBe(Memora);
    expect(MemCharacter).toBe(Memora);
  });

  it("MemCharacter.tsx still re-exports from './Memora'", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "MemCharacter.tsx"),
      "utf8",
    );
    expect(src).toMatch(
      /export\s*\{[^}]*Memora\s+as\s+MemCharacter[^}]*\}\s*from\s*["']\.\/Memora["']/,
    );
  });
});
