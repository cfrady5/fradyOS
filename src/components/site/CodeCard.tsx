import { tokens } from "@/lib/site/tokens";

type Tok = { t: "kw" | "id" | "str" | "pun" | "cm"; v: string };
const kw = (v: string): Tok => ({ t: "kw", v });
const id = (v: string): Tok => ({ t: "id", v });
const str = (v: string): Tok => ({ t: "str", v });
const pun = (v: string): Tok => ({ t: "pun", v });
const cm = (v: string): Tok => ({ t: "cm", v });

const LINES: Tok[][] = [
  [cm("// Brand tokens. Keep the accent rare.")],
  [kw("export"), pun(" "), kw("const"), pun(" "), id("frady"), pun(" = {")],
  ...(
    [
      ["ground", tokens.ground],
      ["ink", tokens.ink],
      ["muted", tokens.muted],
      ["body", tokens.body],
      ["label", tokens.label],
      ["hairline", tokens.hairline],
      ["pixelDim", tokens.pixelDim],
      ["lichen", tokens.lichen],
      ["oak", tokens.oak],
    ] as const
  ).map(([k, v]) => [pun("  "), id(k), pun(": "), str(`"${v}"`), pun(",")]),
  [pun("} "), kw("as"), pun(" "), kw("const"), pun(";")],
];

const COLOR: Record<Tok["t"], string> = { kw: "text-oak", id: "text-ink", str: "text-body", pun: "text-label", cm: "text-label" };

/** Code card: file tab and line-numbered token code. */
export function CodeCard({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex h-10 items-center border-b border-hairline px-4 font-mono text-[12.5px] text-label">frady.tokens.ts</div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.7]">
        {LINES.map((line, i) => (
          <div key={i} className="flex">
            <span className="w-7 shrink-0 text-right text-label select-none" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="ml-4">
              {line.map((tok, j) => (
                <span key={j} className={COLOR[tok.t]}>
                  {tok.v}
                </span>
              ))}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
