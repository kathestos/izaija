import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const [profile, user] = await Promise.all([
    prisma.profile.findUnique({
      where: { clerkUserId: userId },
    }),
    currentUser(),
  ]);

  if (!profile?.isOnboarded) {
    redirect("/onboarding");
  }

  return (
    <DashboardClient
      userName={user?.firstName ?? user?.emailAddresses.at(0)?.emailAddress ?? "Investor"}
    />
  );
}
