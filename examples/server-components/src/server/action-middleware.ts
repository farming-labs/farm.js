let seen = "nobody";

export const getActionUser = () => seen;

export function setActionUser(user: string): void {
  seen = user;
}
