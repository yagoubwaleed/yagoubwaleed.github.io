// Everything the sidebar shows. Each section (and optionally each item) names the
// `place` in the village that the character walks to when it's opened.

export const PROFILE = {
  name: 'Waleed Yagoub',
  intro: [
    "I'm Waleed, I study robot learning at the University of Washington.",
    'I work on making generative policies easy to steer and adapt.',
    'Welcome to my world.',
  ],
};

export const SECTIONS = [
  {
    id: 'about', title: 'About', icon: 'person', place: 'about',
    page: {
      meta: 'Computer Science · University of Washington',
      pills: [
        { label: 'GitHub', href: 'https://github.com/yagoubwaleed', primary: true },
        { label: 'LinkedIn', href: 'https://www.linkedin.com/in/waleedyagoub' },
        { label: 'Google Scholar', href: 'https://scholar.google.com/citations?user=NQIiKFsAAAAJ&hl=en' },
      ],
      facts: [
        ['Studying', 'B.S. Computer Science, UW'],
        ['Graduating', '2027'],
        ['Lab', 'WEIRD Lab'],
        ['Advisor', 'Abhishek Gupta'],
        ['Based in', 'Seattle'],
      ],
      body: `
        <p>I'm very excited about building highly generalizable pretrained policies that make adapting to new
        tasks lightning fast. Everyone has their own belief about what matters most, and I don't claim any
        authority on what the biggest problem worth solving is, but I'm certain quick adaptation would be incredibly
        useful for deploying generalist robots in real settings. Pretraining is a big part of the recipe we can
        tinker with to get there.</p>
        <p>I don't love statements like this, since they obscure how excited I am about pretty much everything else.
        I'm also really interested in dexterity, sensing, full-stack robotics, generative modeling for robotics,
        and much more. If you want someone to talk about any of it with, I'm always down to chat and learn, so
        reach out!</p>
        <p>I've also spent two summers as a software engineering intern at Amazon, and I've been a teaching
        assistant for UW's CSE 351.</p>`,
    },
  },
  {
    id: 'research', title: 'Research', icon: 'flask', place: 'research',
    intro: 'This is what I spend most of my waking hours on. Plenty more on the way, but for now, enjoy :)',
    items: [
      {
        id: 'learning-flows',
        title: 'Flow Pretraining',
        tagline: 'Regularization for efficient downstream steering',
        summary: '<strong>In-Progress, CoRL 2026 2x Workshop Orals</strong>',
        page: {
          title: 'Learning Flows for Efficient Policy Finetuning',
          meta: 'In progress · CoRL 2026 workshops, two <strong>Orals</strong>',
          pills: [
            { label: 'CSIR workshop', href: 'https://csircorl.github.io/website/' },
            { label: 'R2RL workshop · Oral', href: 'https://r2rl-workshop.github.io/' },
            { label: 'Pretrain to Adapt workshop · Oral', href: 'https://corl2026-robotcl.github.io/index.html' },
          ],
          facts: [['Status', 'In progress'], ['Workshops', 'CoRL 2026: CSIR; R2RL (<strong>Oral</strong>); Pretrain to Adapt (<strong>Oral</strong>)'], ['Authorship', 'Co-first author (ordered by coin flip)']],
          body: `
            <p>Flow policies learn a map from noise to actions whose geometry is often badly behaved, which makes
            them hard to steer after pretraining. We propose a pretraining objective that corrects this geometry.</p>
            <p>The resulting latent space supports supervised noise learning through flow inversion, noise-space
            reinforcement learning for action optimization, and smoother gradients for backpropagation through time.
            It enables precise task selection in highly multimodal, multitask policies, including vision-language-action
            models like &pi;<sub>0</sub>, in simulation and on real Franka and YAM robots.</p>`,
        },
      },
      {
        id: 'dsrl',
        title: 'DSRL',
        tagline: 'Steering diffusion policies with latent space RL',
        summary: '<strong>CoRL 2025 Oral</strong>, <strong>Best Paper Nominee</strong>',
        page: {
          title: 'Steering Your Diffusion Policy with Latent Space Reinforcement Learning',
          meta: '<strong>CoRL 2025 Oral</strong> · <strong>Best Paper Nominee</strong>',
          pills: [
            { label: 'Paper', href: 'https://arxiv.org/abs/2506.15799', primary: true },
            { label: 'Project page', href: 'https://diffusion-steering.github.io' },
          ],
          facts: [['Venue', 'CoRL 2025'], ['Recognition', '<strong>CoRL 2025 Oral</strong>, <strong>Best Paper Nominee</strong>'], ['Authorship', 'Co-author']],
          body: `
            <p>Instead of fine-tuning a diffusion policy's weights, DSRL runs reinforcement learning over its
            input noise, learning which noise to sample to get better actions. That makes real-world policy
            improvement sample-efficient, and works even for policies we can only sample from.</p>
            <p>I built the data-collection and behavior-cloning pipelines for our Franka robots, trained the
            diffusion policies, ran the real-world RL experiments, and ran MuJoCo benchmarks against DPPO.</p>`,
        },
      },
      {
        id: 'human-video',
        title: 'Robot Control from Human Video',
        tagline: 'Flow matching from human motion to robot actions',
        page: {
          meta: 'Project · Simulation',
          body: `
            <p>Flow matching usually starts from noise. I was curious what happens if you start from something
            more meaningful instead: if the source distribution is human video or keypoints, can you flow directly
            into the distribution of robot actions?</p>
            <p>I explored this in simulation over a few months, collecting humanoid teleoperation data as the
            starting point. It showed promising results but generalized poorly. With how fast I can iterate now,
            it's an idea I'd love to have pushed further.</p>
            <p>The bigger picture I had in mind: give a generative model like Nano Banana an image of a live scene,
            have it imagine a video of the task being done, then flow from that video to the actions that carry it
            out. A few months later NVIDIA released <a href="https://arxiv.org/abs/2602.15922">DreamZero</a>, which was a nice sign I'd picked a problem worth
            solving. Oh well, what could have been!</p>`,
        },
      },
    ],
  },
  {
    id: 'experience', title: 'Experience', icon: 'briefcase', place: 'experience',
    // one entry per role; add another company by copying an entry
    items: [
      {
        id: 'amazon',
        title: 'Amazon',
        tagline: 'Software Development Engineer Intern',
        summary: "Summers '25 and '26 · Seattle",
        page: {
          title: 'Amazon',
          meta: "Software Development Engineer Intern · Summers '25 and '26",
          facts: [
            ['Role', 'Software Development Engineer Intern'],
            ['Location', 'Seattle'],
            ['When', "Summers '25 and '26"],
          ],
          body: `
            <h3>2026: an agent for merchants</h3>
            <p>I designed, built, and released an agent that lets 100,000+ merchants query, create, and modify data
            on Amazon Supply Chain Services' core platform, which powers 150+ systems. It handles validation and
            security itself, so common support requests no longer need an account manager, product manager, or engineer.</p>
            <p>To ground its answers I built a self-updating vector knowledge base, which I released as a service other
            Amazon agents now use. I also built its debugging, tracing, and evaluation infrastructure, and an MCP server
            entry point for onboarding new tools.</p>
            <h3>2025: serial-number ingestion</h3>
            <p>I built the core ingestion API behind serial-number tracking for 140 million item enrollments. Moving to
            asynchronous streaming, parallel execution, and batching on AWS Lambda and DynamoDB cut ingestion from about
            four hours to twenty seconds.</p>`,
        },
      },
    ],
  },
  {
    id: 'teaching', title: 'Teaching/Leadership', icon: 'board', place: 'teaching',
    // one entry per role; add another by copying an entry
    items: [
      {
        id: 'cse-351',
        title: 'CSE 351: Hardware/Software Interface',
        tagline: 'Teaching Assistant',
        summary: "'24 – '26 · University of Washington · <strong>Guest Lecturer</strong>",
        page: {
          title: 'CSE 351: Hardware/Software Interface',
          meta: "Teaching Assistant · '24 – '26 · <strong>Guest Lecturer</strong>",
          facts: [
            ['Role', 'Teaching Assistant'],
            ['Location', 'University of Washington'],
            ['When', 'Sep 2024 – Jun 2025, Jan – Apr 2026'],
            ['Students supported', '800+'],
            ['Office hours', '100+ sessions'],
          ],
          body: `
            <p>I taught weekly sections of about 30 students on C, assembly, computer architecture, memory management,
            debugging, processes, and concurrency, and I prepared and delivered a full course lecture.</p>
            <p>Outside of section I held 100+ tutoring and office-hour sessions, built Docker-based autograder
            environments, maintained course infrastructure, and mentored incoming TAs.</p>`,
        },
      },
      {
        id: 'ftc',
        title: 'FTC/FRC: Robotics Competitions',
        tagline: 'Team Captain, Mentor',
        summary: "'19 – '23 · Bay Area · <strong>3x World Championship Qualifier</strong>",
        page: {
          meta: "Team Captain, Mentor · '19 – '23 · <strong>3x World Championship Qualifier</strong>",
          facts: [['Role', 'Team Captain, Mentor'], ['Captain', "'21 – '22"], ['Location', 'Bay Area'], ['When', "'19 – '23"], ['Global rank', '26th of ~8,000 teams']],
          body: `
            <p>I'm leaving out four years' worth of detail here, but this was my life all through high school.</p>
            <p>I had the opportunity to lead our FTC team, and we did very well without the external mentors and
            parent contributions many other teams rely on. I was lucky to lead a group of genuinely passionate people,
            who have gone on to do really impressive things with their lives. Through the competition I
            also got to work with and meet some incredible competitors, who I'm sure are doing impressive things too.</p>
            <p>In my senior year, two of my best friends and I had promised each other we'd do FRC together, so we
            did, and the team was just the three of us. In that one season we made it to the Silicon Valley Regional
            final (the video has about 8,000 views on YouTube) and went on to the World Championship. I made so many
            good memories that year.</p>
            <p>This is also where my love of teaching comes from. FTC was a great opportunity to do outreach: working
            with professional companies and organizations to put on thoughtful events that reached thousands of
            students in regions around the world. I'm still really interested in mentoring teams and students who
            are excited about robotics.</p>`,
        },
      },
    ],
  },
  {
    id: 'fun', title: 'Just for fun', icon: 'sparkle', place: 'fun',
    intro: "Things I like when I'm not training policies. Each one has its own spot in my world.",
    // Each item can set its own `place` (fun-1, fun-2, fun-3 are free spots on the map).
    items: [],
    empty: 'Coming soon.',
  },
  {
    id: 'blog', title: 'Thoughts & Ideas', icon: 'pen', place: 'blog',
    intro: 'Notes and writing.',
    items: [],
    empty: 'No posts yet.',
  },
];

// Every paper and role links to a reflection post in the blog. To add one, add a line here:
// [section, item, name] gives a post titled "Reflection: name" and a link to it on that item's page.
const REFLECTIONS = [
  ['research', 'learning-flows', 'Flow Pretraining'],
  ['research', 'dsrl', 'DSRL'],
  ['research', 'human-video', 'Robot Control from Human Video'],
  ['experience', 'amazon', 'Amazon 2025'],
  ['experience', 'amazon', 'Amazon 2026'],
  ['teaching', 'cse-351', 'CSE 351 TA'],
  ['teaching', 'ftc', 'FTC/FRC'],
];
{
  const blog = SECTIONS.find((s) => s.id === 'blog');
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const [sid, iid, name] of REFLECTIONS) {
    const section = SECTIONS.find((s) => s.id === sid), item = section.items.find((x) => x.id === iid);
    const id = `reflection-${slug(name)}`, several = REFLECTIONS.filter((r) => r[0] === sid && r[1] === iid).length > 1;
    blog.items.push({
      id, title: `Reflection: ${name}`,
      page: { pills: [{ label: item.title.split(':')[0], route: `${sid}/${iid}` }], body: '<p>Coming soon.</p>' },
    });
    item.page.pills = [...(item.page.pills || []), { label: several ? `Reflection: ${name}` : 'Reflection', route: `blog/${id}` }];
  }
}
