"use client";

import { TaskSetupMFA } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { getPostAuthRedirectFromParams } from "@/app/auth/redirects";

export function SetupMfaTaskClient() {
  const searchParams = useSearchParams();
  const redirectUrlComplete = getPostAuthRedirectFromParams(searchParams);

  return (
    <div className="w-full max-w-md">
      <TaskSetupMFA redirectUrlComplete={redirectUrlComplete} />
    </div>
  );
}
