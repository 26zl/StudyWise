import type { MeResponse } from "common/auth";

type AuthStatusSnapshot = {
  isError: boolean;
  isFetched: boolean;
  isLoading: boolean;
  data?: MeResponse;
};

export function skalRedirecteTilAuth(auth: AuthStatusSnapshot): boolean {
  return auth.isError || (auth.isFetched && !auth.isLoading && !auth.data?.user);
}
