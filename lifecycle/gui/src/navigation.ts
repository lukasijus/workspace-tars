export interface NavigationItem {
  label: string;
  path: string;
  match: "exact" | "prefix";
}

export const navigationItems: NavigationItem[] = [
  {
    label: "Main",
    path: "/",
    match: "exact",
  },
];

export function isNavigationItemActive(pathname: string, item: NavigationItem) {
  if (item.match === "exact") {
    return pathname === item.path;
  }

  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}
