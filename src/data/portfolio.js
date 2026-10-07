export const projects = [
  {
    id: "bzzd",
    title: "bzzd",
    subtitle: "Autonomous barber stations",
    category: "Robotics",
    period: "2026 — Present",
    image: "/projects/bzzd-prototype.webp",
    imageAlt: "The bzzd prototype and a mannequin head in the university lab",
    caption: "The actual bzzd prototype, testing on a mannequin.",
    summary: "From my dissertation to an autonomous haircutting company.",
    description:
      "I co-founded bzzd to build autonomous barber stations for short back-and-sides haircuts. The robot scans a head, builds a 3D model and generates a cutting plan, then uses vision, depth and force feedback to execute it. Our full-size prototype has completed the scan–plan–cut pipeline on mannequins.",
    detail:
      "I started the project at the University of Bristol, where my dissertation secured lab space, equipment and engineering support for the first prototype. After graduating, I continued full-time as CEO and a technical co-founder. The system integrates a gantry, clipper wrist, cameras, wrist load cells and a deterministic safety controller. The prototype described here has not yet been tested on a person.",
    technologies: [
      "Robotics",
      "Python",
      "ROS 2",
      "LinuxCNC",
      "Jetson",
      "Computer vision",
      "Force feedback",
    ],
    highlights: [
      "Full-size working prototype",
      "3D head scanning and cutting-path planning",
      "Dissertation awarded 85%",
    ],
    links: [{ label: "Visit bzzd.tech", url: "https://bzzd.tech" }],
    gallery: [
      {
        image: "/projects/head-scan.webp",
        caption: "Head-scan point cloud from the bzzd project.",
      },
    ],
  },
  {
    id: "expression-lora",
    title: "Expression LoRAs",
    subtitle: "A dial for facial emotion",
    category: "ML research",
    period: "2024 — 2025",
    image: "/projects/emotion-grid.webp",
    imageAlt:
      "Original generated facial-expression grid with six emotions and eight intensity levels",
    caption:
      "Original project outputs: six emotions, eight intensity levels. These faces are synthetic.",
    summary:
      "Custom SDXL adapters that control the intensity of facial expressions.",
    description:
      "I developed a facial-expression generation system for research with the University of Bristol’s Psychology Department. Using custom Stable Diffusion XL LoRA adapters, I produced photorealistic faces across anger, sadness, happiness, disgust, fear and surprise, each at eight intensity levels.",
    detail:
      "I built the dataset preparation, captioning, training automation and comparison-grid workflow. The OneTrainer pipeline trains adapters for individual emotion and intensity combinations, making it possible to change an expression while keeping the visual presentation consistent. The wider project’s generated stimuli were evaluated in an emotion-recognition study with 101 participants. That study covered two creators’ methods and a four-intensity subset; its aggregate results are not a standalone benchmark of my adapters.",
    technologies: ["Python", "SDXL", "LoRA", "OneTrainer", "Synthetic data"],
    highlights: [
      "6 emotions × 8 intensity levels",
      "Automated training and captioning workflow",
      "Research stimuli for emotion perception",
    ],
    links: [],
    interactive: true,
  },
  {
    id: "vocaloop",
    title: "VocaLoop",
    subtitle: "Your voice, every instrument",
    category: "Audio / software",
    period: "Personal project",
    image: "/projects/vocaloop-studio.webp",
    imageAlt: "VocaLoop studio with named tracks and a demo MIDI arrangement",
    caption:
      "The real VocaLoop frontend, with a playable demo arrangement and refreshed studio interface.",
    summary:
      "A voice-to-MIDI music workstation for turning sung ideas into layered loops.",
    description:
      "I built a browser-based DAW and loopstation that turns vocal recordings into instrument parts. Sing a melody, and the backend detects its notes and rhythm, converts them to MIDI and plays them back as a loop. You can layer parts without needing to play each instrument.",
    detail:
      "The React frontend uses Tone.js for sequencing, tempo control and playback. A Django backend analyses recordings using Praat through Parselmouth for pitch detection and Librosa for timing. The workflow detects note onsets and offsets, filters pitch estimates and quantises the result to the session tempo. The refreshed interface includes named tracks, a MIDI arrangement and a playable example session.",
    technologies: [
      "React",
      "Tone.js",
      "Python",
      "Django",
      "Praat",
      "Librosa",
      "MIDI",
    ],
    highlights: [
      "Voice-to-MIDI conversion",
      "Layered loops and tempo controls",
      "Eight-track studio interface",
    ],
    links: [
      { label: "Open the studio demo", url: "/demos/vocaloop/" },
      { label: "View source", url: "https://github.com/AravRaja/VocaLoop" },
    ],
  },
  {
    id: "ecobot",
    title: "EcoBot",
    subtitle: "A robot that grows plants",
    category: "Robotics / hackathon",
    period: "Brishack 2025",
    image: "/projects/ecobot.webp",
    imageAlt: "EcoBot planting-grid interface from the original project",
    caption:
      "The original EcoBot planting interface. Grid selections are a demonstration; no robot commands were sent.",
    summary: "A smart modular farming system built to win Brishack 2025.",
    description:
      "We built a plant-growing robot at Brishack 2025: a smart modular farming system connecting software, sensors and physical automation. The project won the hackathon.",
    detail:
      "The code includes a React planting grid, a backend that sends commands to the machine and a sensor dashboard. Selected planting positions are translated into G-code for a GRBL-controlled mechanism, connecting an on-screen plan with physical movement.",
    technologies: ["React", "Python", "Node.js", "GRBL", "G-code", "Sensors"],
    highlights: [
      "Brishack 2025 winner",
      "Interactive planting grid",
      "Software connected to physical automation",
    ],
    links: [
      { label: "View source", url: "https://github.com/AravRaja/EcoBot" },
    ],
  },
  {
    id: "lofai",
    title: "LofAI",
    subtitle: "An endless lo-fi stream",
    category: "Generative audio",
    period: "Personal project",
    image: "/projects/lofai.webp",
    imageAlt: "Lo-fi music project cover artwork",
    caption:
      "",
    summary:
      "Code that generates an infinite stream of lo-fi hip-hop and blends it continuously.",
    description:
      "I built LofAI from scratch to generate a continuous stream of lo-fi hip-hop. The project uses a large music dataset assembled from YouTube and blends the generated output into an uninterrupted listening experience.",
    detail:
      "The idea was to treat music as something that keeps unfolding, rather than a playlist with a fixed ending. It brought together my interests in programming, music generation and the transitions between pieces.",
    technologies: ["Generative music", "Audio processing", "Music datasets"],
    highlights: [
      "Continuous music generation",
      "Blended transitions",
      "Built from scratch",
    ],
    links: [],
  },
  {
    id: "vex",
    title: "VEX Robotics",
    subtitle: "From the workshop to Worlds",
    category: "Competition robotics",
    period: "School robotics",
    image: "/projects/vex-robot.webp",
    imageAlt: "An early VEX robot mechanism from Arav’s engineering journal",
    caption: "An early robot build recovered from my VEX engineering journals.",
    summary:
      "Regional and national awards, culminating in the highest programming score at VEX Worlds.",
    description:
      "I started building competition robots at school and went on to achieve the highest programming score at the VEX World Championships. Along the way, I received multiple regional and national VEX awards.",
    detail:
      "Robotics gave me an early reason to bring programming and mechanical design together. My engineering journals document the builds and iterations behind that work, well before I began bzzd.",
    technologies: [
      "Robot programming",
      "Mechanical design",
      "CAD",
      "Autonomous routines",
    ],
    highlights: [
      "Highest programming score at VEX Worlds",
      "Regional and national awards",
      "Hands-on engineering from school onwards",
    ],
    links: [],
  },
];

export const experiences = [
  {
    id: "bzzd",
    title: "Co-founder & CEO",
    company: "bzzd",
    period: "2026 — Present",
    image: "/projects/bzzd-prototype.webp",
    summary:
      "Building autonomous barber stations, full-time after graduating from Bristol.",
    description:
      "I lead bzzd as CEO and technical co-founder. I secured university lab space, equipment and engineering support to take the company from a dissertation proposal to its first prototype.",
    bullets: [
      "Secured university lab space, equipment and engineering support for the first prototype.",
      "Built a system that scans a head, produces a 3D point cloud and plans a haircut.",
      "Integrated hardware and feedback into a scan–plan–cut pipeline tested on mannequins.",
    ],
    link: "/projects?id=bzzd",
    linkLabel: "Explore the prototype",
  },
  {
    id: "softwire",
    title: "Software Engineering Intern",
    company: "Softwire",
    period: "May — Aug 2025",
    summary: "Software engineering internship at Softwire.",
    description:
      "I spent the summer of 2025 at Softwire as a Software Engineering Intern.",
    bullets: [],
    link: null,
  },
  {
    id: "bristol",
    title: "Machine Learning Researcher",
    company: "University of Bristol",
    period: "Dec 2024 — Jun 2025",
    image: "/projects/emotion-grid.webp",
    summary:
      "Generating controlled facial expressions for psychology research.",
    description:
      "I worked on a psychology study investigating how the brain responds to facial emotions, including differences in neurodivergent people. My role was to create controlled visual stimuli for the research.",
    bullets: [
      "Built an automated workflow for dataset captioning and adapter training.",
      "Created comparison grids and controlled expression variations.",
      "Contributed generated stimuli to a wider emotion-recognition research project.",
    ],
    link: "/projects?id=expression-lora",
    linkLabel: "Explore the research",
  },
];
