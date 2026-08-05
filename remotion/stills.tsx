import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill } from "remotion";

const sans = 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const mono = '"SFMono-Regular", "Cascadia Code", Consolas, monospace';

const palette = {
  bg: "#05070d",
  ink: "#f6f8ff",
  muted: "#aeb8cb",
  violet: "#9f8cff",
  cyan: "#5ee7f6",
  mint: "#80f5bb",
};

const background: CSSProperties = {
  backgroundColor: palette.bg,
  backgroundImage: [
    "radial-gradient(circle at 18% 20%, rgba(124,94,255,.42), transparent 38%)",
    "radial-gradient(circle at 82% 22%, rgba(66,219,240,.26), transparent 34%)",
    "radial-gradient(circle at 56% 92%, rgba(96,237,170,.2), transparent 38%)",
    "linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)",
  ].join(","),
  backgroundSize: "auto, auto, auto, 48px 48px, 48px 48px",
  color: palette.ink,
  fontFamily: sans,
};

const Glass = ({ children, style }: { children?: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      border: "1px solid rgba(225,235,255,.24)",
      background: "linear-gradient(145deg, rgba(255,255,255,.13), rgba(255,255,255,.045))",
      boxShadow:
        "inset 0 2px 0 rgba(255,255,255,.2), inset 0 -1px 0 rgba(255,255,255,.04), 0 32px 90px rgba(0,0,0,.46)",
      ...style,
    }}
  >
    {children}
  </div>
);

const Monogram = ({ size }: { size: number }) => (
  <div
    style={{
      width: size,
      height: size,
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: size * 0.31,
        rotate: "-7deg",
        background: `linear-gradient(140deg, ${palette.violet}, #708dff 48%, ${palette.cyan} 76%, ${palette.mint})`,
        boxShadow:
          "inset 0 4px 0 rgba(255,255,255,.46), inset 0 -12px 30px rgba(2,9,18,.23), 0 30px 80px rgba(88,100,255,.36)",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: size * 0.055,
        border: "2px solid rgba(255,255,255,.3)",
        borderRadius: size * 0.27,
        rotate: "-7deg",
      }}
    />
    <div
      style={{
        position: "relative",
        color: "white",
        fontFamily: mono,
        fontSize: size * 0.57,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: "-.13em",
        textShadow: "0 10px 26px rgba(8,12,27,.25)",
        translate: `${-size * 0.018}px ${-size * 0.015}px`,
      }}
    >
      R
    </div>
    <div
      style={{
        position: "absolute",
        right: size * 0.07,
        bottom: size * 0.08,
        width: size * 0.21,
        height: size * 0.21,
        display: "grid",
        placeItems: "center",
        border: `${Math.max(2, size * 0.008)}px solid rgba(5,7,13,.7)`,
        borderRadius: "50%",
        background: palette.mint,
        color: "#07120d",
        boxShadow: "inset 0 2px 0 rgba(255,255,255,.6), 0 0 28px rgba(128,245,187,.7)",
        fontFamily: mono,
        fontSize: size * 0.088,
        fontWeight: 900,
      }}
    >
      ✓
    </div>
  </div>
);

export const RecipeintAvatar = () => (
  <AbsoluteFill style={background}>
    <div
      style={{
        position: "absolute",
        inset: 44,
        border: "1px solid rgba(225,235,255,.11)",
        borderRadius: 220,
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 108,
        border: "1px solid rgba(225,235,255,.08)",
        borderRadius: "50%",
        boxShadow: "0 0 100px rgba(94,231,246,.08)",
      }}
    />
    <Glass
      style={{
        position: "absolute",
        left: 176,
        top: 176,
        width: 648,
        height: 648,
        display: "grid",
        placeItems: "center",
        borderRadius: "50%",
      }}
    >
      <Monogram size={458} />
    </Glass>
    <div
      style={{
        position: "absolute",
        left: 300,
        right: 300,
        bottom: 122,
        height: 4,
        borderRadius: 999,
        background: `linear-gradient(90deg, transparent, ${palette.violet}, ${palette.cyan}, ${palette.mint}, transparent)`,
        boxShadow: "0 0 24px rgba(94,231,246,.55)",
      }}
    />
  </AbsoluteFill>
);

export const RecipeintXBanner = () => (
  <AbsoluteFill style={background}>
    <div
      style={{
        position: "absolute",
        inset: 24,
        overflow: "hidden",
        border: "1px solid rgba(225,235,255,.13)",
        borderRadius: 34,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 60,
          top: 70,
          width: 300,
          height: 300,
          opacity: .96,
        }}
      >
        <Glass style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", borderRadius: 88 }}>
          <Monogram size={210} />
        </Glass>
      </div>

      <div
        style={{
          position: "absolute",
          left: 438,
          right: 82,
          top: 76,
          bottom: 64,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            color: palette.cyan,
            fontFamily: mono,
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: ".16em",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: palette.mint,
              boxShadow: "0 0 18px rgba(128,245,187,.75)",
            }}
          />
          SIGNED LAUNCH PREFLIGHT
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: mono,
            fontSize: 56,
            fontWeight: 820,
            lineHeight: .95,
            letterSpacing: "-.065em",
          }}
        >
          RECIP<span style={{ color: palette.cyan }}>EI</span>NT
        </div>
        <div
          style={{
            maxWidth: 850,
            marginTop: 15,
            fontSize: 42,
            fontWeight: 650,
            lineHeight: 1.08,
            letterSpacing: "-.035em",
          }}
        >
          Catch the mismatch before the <span style={{ color: palette.mint }}>signature.</span>
        </div>
        <div
          style={{
            marginTop: 20,
            display: "flex",
            alignItems: "center",
            gap: 18,
            color: palette.muted,
            fontFamily: mono,
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          <span>Signed launch preflight · Robinhood Chain</span>
          <span style={{ color: "rgba(174,184,203,.5)" }}>{"//"}</span>
          <span>Independent infrastructure</span>
        </div>
      </div>
    </div>
  </AbsoluteFill>
);
