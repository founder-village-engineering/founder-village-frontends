export const screenPaths = {
  home: "/",
  directory: "/directory",
  membership: "/membership",
  deliveries: "/deliveries",
  engineering: "/engineering",
  chats: "/bot-chats",
  profile: "/profile",
} as const;

export type Screen = keyof typeof screenPaths;

export const screenNames: Record<Screen, string> = {
  home: "Home",
  directory: "Directory",
  membership: "Membership",
  deliveries: "Food deliveries",
  engineering: "Engineering",
  chats: "Bot chats",
  profile: "Profile",
};
