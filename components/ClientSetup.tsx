"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppSetup } from "@/components/AppSetup";
import { visitCount } from "@/lib/visits";

/** Clients: "Get the app on your phone" waits its turn: never on the first visit, never on a visit that already had
 *  the Before training pop-up. From the second visit it shows. */
export function ClientSetup() {
  const path = usePathname();
  const [quiet, setQuiet] = useState(true);
  useEffect(() => {
    const visits = visitCount();
    // One prompt per visit, and none on the first: they've only just arrived
    const update = () => {
      let prompted = false; try { prompted = sessionStorage.getItem("dw-prompted") === "1"; } catch { /* fine */ }
      const popup = !!document.querySelector("[data-before-training-open]");
      setQuiet(visits <= 1 || popup || prompted);
    };
    update();
    window.addEventListener("dw-popup", update);
    return () => window.removeEventListener("dw-popup", update);
  }, [path]);
  return <AppSetup quiet={quiet} />;
}
