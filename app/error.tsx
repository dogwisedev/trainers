"use client";
import { ErrorScreen } from "@/components/ErrorScreen";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="px-4 py-16"><ErrorScreen error={error} reset={reset} /></main>; }
