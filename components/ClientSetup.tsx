"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppSetup } from "@/components/AppSetup";

/** Clients: "Get the app on your phone" waits its turn. Never while the Before training pop-up is open, and on the
 *  first visit not while there's still something to do before training (that comes first). From the second visit it shows. */
export function ClientSetup() {
  const path = usePathname();
  const [quiet, setQuiet] = useState(true);
  useEffect(() => {
    let visits = 2;
    try {
      if (!sessionStorage.getItem("dw-visit")) { sessionStorage.setItem("dw-visit", "1"); localStorage.setItem("dw-visits", String(Number(localStorage.getItem("dw-visits") || 0) + 1)); }
      visits = Number(localStorage.getItem("dw-visits") || 1);
    } catch { /* private mode: just show it */ }
    const update = () => {
      const popup = !!document.querySelector("[data-before-training-open]");
      const todo = !!document.querySelector("[data-before-training]");
      setQuiet(popup || (visits <= 1 && todo));
    };
    update();
    window.addEventListener("dw-popup", update);
    return () => window.removeEventListener("dw-popup", update);
  }, [path]);
  return <AppSetup quiet={quiet} />;
}
