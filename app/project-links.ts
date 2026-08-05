export type ProjectLinkStatus = "live" | "after-launch" | "coming-soon";

export type ProjectLink = {
  label: string;
  shortLabel: string;
  href: string | null;
  status: ProjectLinkStatus;
};

export const FRONG_CONTRACT = "0x6245e67affa44a23077f0ea7f981a8dc743a0c47";
export const TOKEN_CONTRACT: string | null = "0x24Af85cbA4045F9330DAD160CD02d4287310e03c";
export const TOKEN_TRADE_URL: string | null =
  "https://pools.trade/t/0x24Af85cbA4045F9330DAD160CD02d4287310e03c";
export const X_URL: string | null = "https://x.com/Recipeint";
export const TELEGRAM_URL: string | null = "https://t.me/recipeint";

const tokenExplorerUrl = TOKEN_CONTRACT
  ? `https://robinhoodchain.blockscout.com/token/${TOKEN_CONTRACT}`
  : null;

export const projectLinks = {
  token: {
    label: "Token contract",
    shortLabel: "Contract",
    href: TOKEN_TRADE_URL || tokenExplorerUrl,
    status: TOKEN_CONTRACT ? "live" : "after-launch",
  },
  x: {
    label: "X / Twitter",
    shortLabel: "X",
    href: X_URL,
    status: X_URL ? "live" : "coming-soon",
  },
  telegram: {
    label: "Telegram",
    shortLabel: "Telegram",
    href: TELEGRAM_URL,
    status: TELEGRAM_URL ? "live" : "coming-soon",
  },
  frong: {
    label: "FRONG contract",
    shortLabel: "FRONG",
    href: `https://robinhoodchain.blockscout.com/token/${FRONG_CONTRACT}`,
    status: "live",
  },
} satisfies Record<"token" | "x" | "telegram" | "frong", ProjectLink>;

export const projectLinkList: readonly ProjectLink[] = [
  projectLinks.token,
  projectLinks.x,
  projectLinks.telegram,
];

export const projectLinkStatusLabel: Record<ProjectLinkStatus, string> = {
  live: "Open",
  "after-launch": "After launch",
  "coming-soon": "Coming soon",
};
