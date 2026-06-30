"use client";

import { Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

export function OnboardingForm() {
  const router = useRouter();
  const [initialCash, setInitialCash] = useState("10000");
  const completeOnboarding = trpc.profile.completeOnboarding.useMutation({
    onSuccess: () => {
      router.push("/dashboard");
      router.refresh();
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    completeOnboarding.mutate({ initialCash: Number(initialCash) });
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Wallet className="size-5" aria-hidden="true" />
        </div>
        <CardTitle>Set your starting balance</CardTitle>
        <CardDescription>
          This is virtual cash only. It becomes your mock investing budget.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="initialCash">Virtual cash amount</Label>
            <Input
              id="initialCash"
              min="1"
              step="0.01"
              type="number"
              value={initialCash}
              onChange={(event) => setInitialCash(event.target.value)}
            />
          </div>
          {completeOnboarding.error ? (
            <p className="text-sm text-destructive">
              {completeOnboarding.error.message}
            </p>
          ) : null}
          <Button className="w-full" disabled={completeOnboarding.isPending}>
            Continue to dashboard
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
