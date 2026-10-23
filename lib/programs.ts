// The 7 Dogwise programs, as named on the handover report and certificate, and the standard text in every report.

export const PROGRAMS = [
  "Adolescent Essentials", "Anxiety Support", "Big Puppy", "Puppy Foundations",
  "Reactivity & Aggression Reset", "Rescue Restart", "Strong Companion"
] as const;
export type Program = (typeof PROGRAMS)[number];

/** HubSpot / booking program name → report program. */
export function programFor(name: string | null | undefined): Program | null {
  const n = String(name || "").toLowerCase();
  if (!n) return null;
  const exact = PROGRAMS.find((p) => p.toLowerCase() === n);
  if (exact) return exact;
  if (/aggress|reactiv|rehab/.test(n)) return "Reactivity & Aggression Reset";
  if (/anxi/.test(n)) return "Anxiety Support";
  if (/big puppy/.test(n)) return "Big Puppy";
  if (/puppy/.test(n)) return "Puppy Foundations";
  if (/rescue/.test(n)) return "Rescue Restart";
  if (/strong companion/.test(n)) return "Strong Companion";
  if (/adolescent|adult|obedience|behaviou?r/.test(n)) return "Adolescent Essentials";
  return null;
}

/** "About the program" text. Programs without text yet simply leave the section out. */
export const ABOUT: Partial<Record<Program, string[]>> = {
  "Adolescent Essentials": [
    "Navigating the teenage phase of your dog can be challenging. Our Adolescent Obedience Program is designed to guide your growing pup toward becoming a well-mannered, joyful family member.",
    "Your dog will live with an experienced trainer in a home environment, learning practical skills that translate seamlessly to your household. Ideal for busy families, we handle the training, allowing you to enjoy a happier pup and a smoother daily routine.",
    "Training is not about exerting control; it's about building trust and fostering joy."
  ]
};

export const TRAINER_RESPONSIBILITIES = "Our Dogwise dog trainers play a crucial role in helping both you and your furry companion develop a strong and harmonious relationship. Their primary responsibility is to facilitate effective communication between you and your dog, ensuring that your pet understands and obeys commands. They focus on teaching essential skills, such as obedience commands, leash walking, and proper socialization. Additionally, a dog trainer can address behavioral issues like aggression, anxiety, or excessive barking, providing tailored solutions to improve your dog's behavior and overall well-being. Through positive reinforcement and patience, they work to instill good manners and desirable behaviors in your dog while equipping you with the tools and knowledge needed to maintain consistent training at home. Ultimately, the main goal of a dog trainer is to enhance the bond between you and your four-legged friend, creating a happy and well-adjusted canine companion.";

export const CLIENT_RESPONSIBILITIES = "Continuing to work with your dog at home after they've completed the Dogwise Academy program is of paramount importance. Your responsibilities as a dog owner extend beyond their time with our Academy, and they play a pivotal role in reinforcing and maintaining the skills your dog has acquired. Consistent practice at home helps solidify the training and ensures that your dog continues to respond to commands and exhibit good behavior. It also helps in strengthening the bond between you and your dog, as it fosters trust and communication. Regular home training provides mental stimulation and exercise for your dog, which is crucial for their overall well-being. Moreover, it allows you to address any specific challenges or behaviors that may arise in your unique living environment. In essence, working with your dog at home is not just a responsibility; it's a key factor in ensuring that the positive changes achieved through professional training become a lasting and integral part of your dog's life.";

export const CEO_MESSAGE = [
  "From the bottom of our hearts, thank you for entrusting Dogwise Academy with the training journey of your cherished companion.",
  "Your decision to choose us is more than just a business interaction; it's a bond we deeply cherish.",
  "Every wagging tail and joyful bark we witness is a testament to the love and dedication you have for your pet. Our team is not only driven by their expertise but also by the inspiring commitment of pet parents like you.",
  "At Dogwise Academy, we don't see the end of a program as a goodbye. Instead, it's the beginning of a lifelong partnership. We're excited to be by your side, celebrating every milestone and overcoming any hurdles together.",
  "Thank you for being a part of the Dogwise family. Remember, our journey together has just begun, and we're here with you, every paw of the way."
];
export const CEO_NAME = "Sean Devereux";
