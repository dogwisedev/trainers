"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";

// A 2-minute guided tour of the real trainer app: highlights each part of the screen with a sentence, then moves on,
// page to page. Start: the card on Home, "Take the tour again" on Profile, or any link with ?tour=1.
type Step = { page: "home" | "chats" | "chat" | "forms" | "calendar" | "pay" | "profile"; sel: string; title: string; text: string; centre?: boolean };
const STEPS: Step[] = [
  { page: "home", sel: "", centre: true, title: "Welcome to the Dogwise app", text: "Your dogs, your client chats, your forms and your pay, all in one place. This takes 2 minutes: tap Next to see where everything is." },
  { page: "home", sel: '[data-tour="week"]', title: "Your week", text: "Your dogs and kennels for the coming weeks. Each square is a kennel: dark means a dog is booked, light means free." },
  { page: "home", sel: '[data-tour="todo"]', title: "To do", text: "Forms that are due for your dogs. Tap Start to fill one in." },
  { page: "home", sel: '[data-tour="with-you"]', title: "With you now", text: "The dogs in your care right now, with their dates." },
  { page: "home", sel: '[data-tour="nav-chats"]', title: "Chats", text: "Every dog has a chat with you, the client and the Dogwise team. Let's open them." },
  { page: "chats", sel: '[data-tour="chat-row"]', title: "One chat per dog", text: "Chats that need a reply are always at the top. Tap one to open it." },
  { page: "chats", sel: '[data-tour="team"]', title: "The Dogwise team", text: "Questions about a dog, a pickup or your calendar? Message the team here." },
  { page: "chat", sel: '[data-tour="composer"]', title: "Post every day", text: "Type here to message the client. Post at least one photo or video of the dog every day." },
  { page: "chat", sel: '[data-tour="attach"]', title: "Photos and videos", text: "Tap the paperclip to send photos or videos straight from your phone." },
  { page: "chat", sel: '[data-tour="dog-profile"]', title: "Dog profile", text: "Everything about the dog: vet, food, medication, behaviour and vaccines." },
  { page: "chat", sel: '[data-tour="incident"]', title: "Report incident", text: "If something happens (an injury, an escape, a bite), tap this. The team is told straight away." },
  { page: "forms", sel: '[data-tour="nav-reports"]', title: "Reports", text: "All your forms live here, under Reports in the menu. The red number shows how many are due." },
  { page: "forms", sel: '[data-tour="forms"]', title: "Your forms", text: "Pickup form on pickup day (with your miles). Weekly health check between Thursday and Wednesday: late or missing ones cost $100. Handover form on drop-off day. Tap Start to fill one in." },
  { page: "calendar", sel: '[data-tour="time-off"]', title: "Time off", text: "Block the dates you can't take dogs, and we won't book you then." },
  { page: "pay", sel: '[data-tour="pay"]', title: "Pay", text: "Your payslips, every other Friday. Each one is emailed to you too." },
  { page: "pay", sel: '[data-tour="miles"]', title: "Miles and follow-ups", text: "Your miles from pickups, drop-offs and follow-up sessions (keep this for tax time). Log a follow-up session here." },
  { page: "profile", sel: '[data-tour="setup"]', title: "Notifications", text: "Turn on notifications so you never miss a message. Your password is under the key icon at the top." },
  { page: "profile", sel: "", centre: true, title: "You're all set", text: "That's everything. Questions? Message the team in Chats, under Dogwise team. You can take this tour again any time, here on Profile." }
];
const PAGE_PATH: Record<Step["page"], string> = { home: "/t", chats: "/t/chats", chat: "", forms: "/t/reports", calendar: "/t/calendar", pay: "/t/pay", profile: "/t/profile" };
const pageOf = (path: string): Step["page"] | null =>
  path === "/t" ? "home" : path === "/t/chats" ? "chats" : /^\/t\/chats\/[^/]+$/.test(path) ? "chat" : path === "/t/reports" ? "forms" : path === "/t/calendar" ? "calendar" : path === "/t/pay" ? "pay" : path === "/t/profile" ? "profile" : null;
const KEY = "dogwise-tour", DONE = "dogwise-tour-done";
const visible = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed") || null;

export function startTour() { try { localStorage.setItem(KEY, JSON.stringify({ i: 0 })); } catch { /* ignore */ } location.href = "/t"; }

export function TrainerTour() {
  const path = usePathname(), router = useRouter();
  const [state, setState] = useState<{ i: number; chat?: string } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    try {
      if (new URLSearchParams(location.search).get("tour") === "1") localStorage.setItem(KEY, JSON.stringify({ i: 0 }));
      const s = localStorage.getItem(KEY); setState(s ? JSON.parse(s) : null);
    } catch { /* private mode */ }
  }, [path]);
  const save = (s: { i: number; chat?: string } | null) => { setState(s); try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* ignore */ } };
  const step = state ? STEPS[state.i] : null;
  const here = pageOf(path);
  // Find and follow the highlighted element
  const measure = useCallback(() => { if (!step || step.page !== here) return setRect(null); const el = visible(step.sel); setRect(el ? el.getBoundingClientRect() : null); }, [step, here]);
  useEffect(() => {
    setRect(null); setSkipped(false); // never leave the previous step's highlight on screen
    if (!step || step.page !== here) return;
    let tries = 0;
    if (step.centre) return;
    const t = setInterval(() => {
      const el = visible(step.sel);
      if (el) { clearInterval(t); el.scrollIntoView({ block: "center", behavior: "smooth" }); setTimeout(measure, 350); }
      else if (++tries > 15) { clearInterval(t); setSkipped(true); }
    }, 100);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { clearInterval(t); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step, here, measure]);
  const go = (n: number) => {
    if (!state) return;
    if (n >= STEPS.length) { save(null); try { localStorage.setItem(DONE, "1"); } catch { /* ignore */ } return; }
    if (n < 0) return;
    let next = STEPS[n];
    let chat = state.chat;
    // Leaving the chat list: open the first chat (or skip the chat steps if there are none)
    if (next.page === "chat" && !chat) {
      const a = document.querySelector<HTMLAnchorElement>('[data-tour="chat-row"] a');
      if (a) chat = a.getAttribute("href") || undefined;
      else { while (n < STEPS.length && STEPS[n].page === "chat") n++; next = STEPS[n]; }
    }
    save({ i: n, chat });
    if (next && next.page !== here) router.push(next.page === "chat" ? chat! : PAGE_PATH[next.page]);
  };  // A part that isn't on this trainer's screen: move on to the next step by itself
  useEffect(() => { if (skipped && state) go(state.i + 1); }, [skipped]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state || !step) return null;
  // On the wrong page (e.g. after tapping around): offer to carry on
  if (step.page !== here) {
    return (
      <div className="fixed inset-x-3 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[70] md:bottom-6 md:left-auto md:right-6 md:w-[380px]">
        <div className="panel flex items-center gap-3 p-3 shadow-lift">
          <p className="min-w-0 flex-1 text-[14px]"><b>Tour paused.</b> Step {state.i + 1} of {STEPS.length}.</p>
          <button type="button" className="btn-ink h-9 min-h-0 px-3 text-[13px]" onClick={() => router.push(step.page === "chat" ? state.chat || "/t/chats" : PAGE_PATH[step.page])}>Carry on</button>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-full hover:bg-paper" aria-label="End the tour" onClick={() => { save(null); try { localStorage.setItem(DONE, "1"); } catch { /* ignore */ } }}><X size={16} /></button>
        </div>
      </div>
    );
  }

  const pad = 8, r = step.centre ? null : rect;
  const below = !r || r.top < window.innerHeight * 0.5;
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`Tour step ${state.i + 1}`}>
      {r ? <div className="pointer-events-none absolute rounded-[18px] ring-4 ring-lav transition-all duration-300" style={{ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2, boxShadow: "0 0 0 9999px rgba(30,18,80,.55)" }} />
        : <div className="absolute inset-0 bg-[rgba(30,18,80,.55)]" />}
      <div className={`absolute inset-x-3 md:left-1/2 md:w-[420px] md:-translate-x-1/2 ${r ? (below ? "" : "") : "top-1/2 -translate-y-1/2 md:translate-y-[-50%]"}`}
        style={r ? (below ? { top: Math.min(r.bottom + pad + 12, window.innerHeight - 230) } : { top: Math.max(r.top - pad - 12 - 200, 12) }) : undefined}>
        <div className="panel p-4 shadow-lift">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-bold text-lav-deep">Step {state.i + 1} of {STEPS.length}</p>
            <button type="button" className="text-[13px] font-semibold text-ink-soft underline" onClick={() => { save(null); try { localStorage.setItem(DONE, "1"); } catch { /* ignore */ } }}>Skip tour</button>
          </div>
          {step.centre && <span className="mx-auto mt-2 grid h-16 w-16 place-items-center rounded-[20px] bg-paper"><img src="/icons/mark.png" alt="" className="h-10 w-10" /></span>}
          <h2 className={`mt-1 font-extrabold ${step.centre ? "text-center text-[22px]" : "text-[19px]"}`}>{step.title}</h2>
          <p className={`mt-1 text-[15px] leading-snug text-ink-soft ${step.centre ? "text-center" : ""}`}>{step.text}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-lav" style={{ width: `${((state.i + 1) / STEPS.length) * 100}%` }} /></div>
          <div className="mt-3 flex gap-2">
            {state.i > 0 && <button type="button" className="btn-ghost h-10 min-h-0 flex-1" onClick={() => { const p = STEPS[state.i - 1]; save({ ...state, i: state.i - 1 }); if (p.page !== here) router.push(p.page === "chat" ? state.chat || "/t/chats" : PAGE_PATH[p.page]); }}>Back</button>}
            <button type="button" className="btn-ink h-11 min-h-0 flex-[2]" onClick={() => go(state.i + 1)}>{state.i === 0 ? "Show me around" : state.i === STEPS.length - 1 ? "Finish" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Card on trainer Home: "New here? Take the 2-minute tour" (until taken or dismissed). */
export function TourInvite() {
  const [show, setShow] = useState(false);
  useEffect(() => { try { setShow(!localStorage.getItem(DONE) && !localStorage.getItem(KEY)); } catch { /* ignore */ } }, []);
  if (!show) return null;
  return (
    <div className="panel mb-4 overflow-hidden border-lav/40">
      <div className="flex items-center gap-3 p-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-paper"><img src="/icons/mark.png" alt="" className="h-8 w-8" /></span>
        <div className="min-w-0 flex-1"><p className="font-bold">New to the app?</p><p className="text-[14px] text-ink-soft">A 2-minute tour shows you where everything is.</p></div>
      </div>
      <div className="flex border-t border-line">
        <button type="button" className="flex-1 px-4 py-3 text-[14px] font-semibold text-ink-soft hover:bg-paper/60" onClick={() => { try { localStorage.setItem(DONE, "1"); } catch { /* ignore */ } setShow(false); }}>Not now</button>
        <button type="button" className="flex-1 border-l border-line bg-ink px-4 py-3 text-[14px] font-bold text-white" onClick={startTour}>Take the tour</button>
      </div>
    </div>
  );
}

/** Button on Profile: take the tour again. */
export function TourAgain() {
  return <button type="button" className="btn-ghost mt-4 w-full sm:w-auto" onClick={startTour}>Take the app tour again</button>;
}
