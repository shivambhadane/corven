import type { ReactNode } from "react";
import { Header } from "@/components/Header";

// The marketplace itself (jobs, job pages): wallet header and the app's page frame.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="page">{children}</main>
    </>
  );
}
