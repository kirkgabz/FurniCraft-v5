import { notFound } from "next/navigation";
import PieceShotsClient from "./piece-shots-client";

/**
 * Opens one studio piece exactly as a customer first sees it, so
 * scripts/capture-piece-shots.mts can photograph its default design for the
 * picker. Development only: a production build answers 404, and the session
 * proxy lets it through without sign-in only in development.
 */
export default function PieceShotsPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PieceShotsClient />;
}
