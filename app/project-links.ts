export type ProjectLinkStatus = "live" | "after-launch" | "coming-soon";

export type ProjectLink = {
  label: string;
  shortLabel: string;
  href: string | null;
  status: ProjectLinkStatus;
};

export const FRONG_CONTRACT = "0x6245e67affa44a23077f0ea7f981a8dc743a0c47";

export const projectLinks = {
  token: {
    label: "Token contract",
    shortLabel: "Contract",
    href: null,
    status: "after-launch",
  },
  x: {
    label: "X / Twitter",
    shortLabel: "X",
    href: null,
    status: "coming-soon",
  },
  telegram: {
    label: "Telegram",
    shortLabel: "Telegram",
    href: null,
    status: "coming-soon",
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
