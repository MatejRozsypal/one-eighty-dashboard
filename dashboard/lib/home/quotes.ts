/**
 * The quote of the day on Home: 100 short lines from people who built
 * businesses, each with its author and where it was said or written.
 *
 * Every entry was checked against a primary or reputable source (the book,
 * the shareholder letter, the talk, the author's own post, or Quote
 * Investigator / Wikiquote's sourced section). The URL for each is in
 * `docs/sessions/2026-10-08/home-quotes-sources.md`; lines that only live on
 * quote sites were left out. Pure, safe anywhere.
 */

export interface Quote {
  text: string;
  author: string;
  source: string;
}

export const QUOTES: Quote[] = [
  { text: "People don't have shorter attention spans, they have higher standards.", author: "Alex Hormozi", source: "$100M Leads (2023)" },
  { text: "Failure is an option here. If things are not failing, you are not innovating enough.", author: "Elon Musk", source: "Fast Company, 'Hondas in Space', 2005" },
  { text: "Don't waste your effort on a thing which ends in a petty triumph unless you are satisfied with a life of petty success.", author: "John D. Rockefeller", source: "Random Reminiscences of Men and Events (1909)" },
  { text: "A person who pays with their time now is more likely to pay with their money later.", author: "Alex Hormozi", source: "$100M Leads (2023)" },
  { text: "Put all your eggs in one basket, and then watch that basket.", author: "Andrew Carnegie", source: "'The Road to Business Success' address, Curry Commercial College, 1885" },
  { text: "It's far better to buy a wonderful company at a fair price than a fair company at a wonderful price.", author: "Warren Buffett", source: "Berkshire Hathaway letter, 1989" },
  { text: "The business that provides the most value wins. Period.", author: "Alex Hormozi", source: "$100M Leads (2023)" },
  { text: "I constantly see people rise in life who are not the smartest, sometimes not even the most diligent. But they are learning machines.", author: "Charlie Munger", source: "USC Gould School of Law commencement, 2007 (Poor Charlie's Almanack)" },
  { text: "Day 2 is stasis. Followed by irrelevance. Followed by excruciating, painful decline. Followed by death. And that is why it is always Day 1.", author: "Jeff Bezos", source: "Amazon shareholder letter, 2016" },
  { text: "The only way to do great work is to love what you do. If you haven't found it yet, keep looking. Don't settle.", author: "Steve Jobs", source: "Stanford commencement, 2005" },
  { text: "Volume negates luck.", author: "Alex Hormozi", source: "The Game podcast, \"Volume Negates Luck | Ep 266\" (12 Jan 2021)" },
  { text: "Failure is only the opportunity more intelligently to begin again. There is no disgrace in honest failure; there is disgrace in fearing to fail.", author: "Henry Ford", source: "My Life and Work (1922)" },
  { text: "Commit to your business. Believe in it more than anybody else.", author: "Sam Walton", source: "Made in America (1992), rule 1" },
  { text: "Everyone wants to be successful. No one wants to be embarrassed. The price of the first is the second.", author: "Alex Hormozi", source: "X post, 26 Feb 2025" },
  { text: "Let everyone else call your idea crazy... just keep going. Don't stop. Don't even think about stopping until you get there.", author: "Phil Knight", source: "Shoe Dog (2016), p. 5" },
  { text: "Your most unhappy customers are your greatest source of learning.", author: "Bill Gates", source: "Business @ the Speed of Thought (1999)" },
  { text: "No one has ever gotten better at anything by feeling sorry for themselves.", author: "Alex Hormozi", source: "X post, 15 Apr 2024" },
  { text: "People with very high expectations have very low resilience, and unfortunately, resilience matters in success.", author: "Jensen Huang", source: "Stanford talk, March 2024 (reported by Fortune)" },
  { text: "I have never worked a day in my life without selling. If I believe in something, I sell it, and I sell it hard.", author: "Estee Lauder", source: "Quoted in AP obituary, 2004" },
  { text: "Success is not an entitlement: it must be earned.", author: "Howard Schultz", source: "Talk at Notre Dame, 'Entrepreneurship and Ethics', 2007" },
  { text: "Success is hard because it requires consistency not complexity.", author: "Alex Hormozi", source: "X post, 31 Aug 2022" },
  { text: "When being embarrassed actually becomes the goal, it flips the whole thing on its head.", author: "Sara Blakely", source: "CNBC, October 2020" },
  { text: "Learn to sell. Learn to build. If you can do both, you will be unstoppable.", author: "Naval Ravikant", source: "How to Get Rich tweetstorm, 2018" },
  { text: "A business owner wins by making the same customer more valuable to his business than to his competition.", author: "Alex Hormozi", source: "X post, 22 Jun 2024" },
  { text: "Brilliant thinking is rare, but courage is in even shorter supply than genius.", author: "Peter Thiel", source: "Zero to One (2014), p. 5" },
  { text: "Truth, or more precisely, an accurate understanding of reality, is the essential foundation for any good outcome.", author: "Ray Dalio", source: "Principles: Life and Work (2017), principles.com" },
  { text: "Patience isn't about waiting... It's about figuring out what to do in the meantime.", author: "Alex Hormozi", source: "X post, 24 Apr 2023" },
  { text: "Business success contains the seeds of its own destruction.", author: "Andy Grove", source: "Only the Paranoid Survive (1996), Preface" },
  { text: "There is only one valid definition of a business purpose: to create a customer.", author: "Peter Drucker", source: "The Practice of Management (1954), p. 37" },
  { text: "The way to get startup ideas is not to try to think of startup ideas. It's to look for problems, preferably problems you have yourself.", author: "Paul Graham", source: "How to Get Startup Ideas, essay (2012)" },
  { text: "The simplest explanation for hiring a team: You can outwork anyone but you can't outwork everyone.", author: "Alex Hormozi", source: "X post, 5 Oct 2025" },
  { text: "If each of us hires people who are bigger than we are, we shall become a company of giants.", author: "David Ogilvy", source: "Ogilvy on Advertising (1983), p. 47" },
  { text: "The only way on earth to influence other people is to talk about what they want and show them how to get it.", author: "Dale Carnegie", source: "How to Win Friends and Influence People (1936), Part 1" },
  { text: "Only thing worse than hiring smart people who leave you is hiring dumb people who stay.", author: "Alex Hormozi", source: "X post, 12 Jun 2023" },
  { text: "The key is not to prioritize what's on your schedule, but to schedule your priorities.", author: "Stephen Covey", source: "The 7 Habits of Highly Effective People (1989), p. 161" },
  { text: "Leaders must own everything in their world. There is no one else to blame.", author: "Jocko Willink", source: "Extreme Ownership (2015, with Leif Babin)" },
  { text: "Productivity comes from all the things you choose not to do.", author: "Alex Hormozi", source: "X post, 1 Feb 2025" },
  { text: "The major reason for setting goals is to compel you to become the person it takes to achieve them.", author: "Jim Rohn", source: "7 Strategies for Wealth & Happiness (1985; 1996 ed.)" },
  { text: "Stagnation is almost certain, and stagnation is slow-motion failure. If you're not climbing, you're sliding.", author: "Tobi Lutke", source: "Shopify memo on reflexive AI usage, shared on X, April 2025" },
  { text: "Go deep on things. Become an expert.", author: "Patrick Collison", source: "Advice, patrickcollison.com" },
  { text: "Focus + work ethic + time = wealth.", author: "Alex Hormozi", source: "X post, 2 Feb 2025" },
  { text: "The only advantage I want is a starving crowd!", author: "Gary Halbert", source: "The Boron Letters (1984), ch. 6" },
  { text: "The hidden cost and failure in all advertising and marketing is the almost-persuaded.", author: "Dan Kennedy", source: "No B.S. Direct Marketing (2006), Rule 2" },
  { text: "A focused fool can accomplish more than a distracted genius.", author: "Alex Hormozi", source: "X post, 20 Oct 2022" },
  { text: "Every adversity brings with it the seed of an equivalent advantage.", author: "Napoleon Hill", source: "Think and Grow Rich (1937)" },
  { text: "When something is important enough, you do it even if the odds are not in your favor.", author: "Elon Musk", source: "CBS 60 Minutes, 18 March 2012" },
  { text: "To succeed you just need to do so many reps that it would be unreasonable for you to fail.", author: "Alex Hormozi", source: "X post, 6 Apr 2025" },
  { text: "Be sure that before you go into an enterprise you see your way clear to stay through to a successful end.", author: "John D. Rockefeller", source: "Random Reminiscences of Men and Events (1909)" },
  { text: "No man will make a great business who wants to do it all himself, or to get all the credit of doing it.", author: "Andrew Carnegie", source: "Interview, St. Louis Globe-Democrat, 1899" },
  { text: "Should you find yourself in a chronically-leaking boat, energy devoted to changing vessels is likely to be more productive than energy devoted to patching leaks.", author: "Warren Buffett", source: "Berkshire Hathaway letter, 1985" },
  { text: "Talented people do more reps than untalented people. The reps make them talented. The talent doesn't make them do reps.", author: "Alex Hormozi", source: "X post, 1 Feb 2024" },
  { text: "Spend each day trying to be a little wiser than you were when you woke up.", author: "Charlie Munger", source: "Poor Charlie's Almanack" },
  { text: "Most decisions should probably be made with somewhere around 70% of the information you wish you had. If you wait for 90%, in most cases, you're probably being slow.", author: "Jeff Bezos", source: "Amazon shareholder letter, 2016" },
  { text: "If you want to feel better, blame others. If you want to get better, blame yourself.", author: "Alex Hormozi", source: "X post, 15 Nov 2024" },
  { text: "You can't connect the dots looking forward; you can only connect them looking backward.", author: "Steve Jobs", source: "Stanford commencement, 2005" },
  { text: "Thinking is the hardest work any one can do, which is probably the reason why we have so few thinkers.", author: "Henry Ford", source: "My Life and Work (1922)" },
  { text: "When in doubt, make it more expensive.", author: "Alex Hormozi", source: "X post, 28 Jun 2025" },
  { text: "The more they know, the more they'll understand. The more they understand, the more they'll care. Once they care, there's no stopping them.", author: "Sam Walton", source: "Made in America (1992), rule 4" },
  { text: "I wanted to focus constantly on the one task that really mattered.", author: "Phil Knight", source: "Shoe Dog (2016), p. 117" },
  { text: "Success is a lousy teacher. It seduces smart people into thinking they can't lose.", author: "Bill Gates", source: "The Road Ahead (1995)" },
  { text: "How to charge exorbitant prices: Increase demand. Cut supply. If you know how to market, you control both.", author: "Alex Hormozi", source: "X post, 3 Aug 2022" },
  { text: "I never dreamed about success. I worked for it.", author: "Estee Lauder", source: "The Estee Lauder Companies, 'Our Founder'" },
  { text: "Play iterated games. All returns in life, whether in wealth, relationships, or knowledge come from compound interest.", author: "Naval Ravikant", source: "How to Get Rich tweetstorm, 2018" },
  { text: "Easiest way to double your prices: Do the same job in half the time.", author: "Alex Hormozi", source: "X post, 11 Apr 2024" },
  { text: "Today's \"best practices\" lead to dead ends; the best paths are new and untried.", author: "Peter Thiel", source: "Zero to One (2014), p. 1" },
  { text: "Pain + Reflection = Progress. Go to the pain rather than avoid it.", author: "Ray Dalio", source: "Principles: Life and Work (2017), principles.com" },
  { text: "The best way to retain a customer is to sell them something else.", author: "Alex Hormozi", source: "X post, 21 Apr 2024" },
  { text: "Your career is literally your business, and you are its CEO.", author: "Andy Grove", source: "Only the Paranoid Survive (1996), ch. 10" },
  { text: "Whenever anything is being accomplished, it is being done, I have learned, by a monomaniac with a mission.", author: "Peter Drucker", source: "Adventures of a Bystander (1979)" },
  { text: "Actually startups take off because the founders make them take off.", author: "Paul Graham", source: "Do Things That Don't Scale, essay (2013)" },
  { text: "Give away generic. Sell specific.", author: "Alex Hormozi", source: "X post, 17 Jun 2024" },
  { text: "When I write an advertisement, I don't want you to tell me that you find it \"creative\". I want you to find it so interesting that you buy the product.", author: "David Ogilvy", source: "Ogilvy on Advertising (1983), p. 7" },
  { text: "You can make more friends in two months by becoming genuinely interested in other people than you can in two years by trying to get other people interested in you.", author: "Dale Carnegie", source: "How to Win Friends and Influence People (1936), Part 2" },
  { text: "You don't need to know it's going to work to start, you just need to know it's going to work better than doing nothing.", author: "Alex Hormozi", source: "X post, 2 Oct 2026" },
  { text: "Most people do not listen with the intent to understand; they listen with the intent to reply.", author: "Stephen Covey", source: "The 7 Habits of Highly Effective People (1989), p. 239" },
  { text: "It's not what you preach, it's what you tolerate.", author: "Jocko Willink", source: "Extreme Ownership (2015, with Leif Babin)" },
  { text: "Marketing made for 1 real person outperforms marketing made for 1000 hypothetical people.", author: "Alex Hormozi", source: "X post, 20 Jan 2025" },
  { text: "What you become is far more important than what you get.", author: "Jim Rohn", source: "7 Strategies for Wealth & Happiness (1985; 1996 ed.)" },
  { text: "Nobody is going to teach you to think for yourself. A large fraction of what people around you believe is mistaken.", author: "Patrick Collison", source: "Advice, patrickcollison.com" },
  { text: "Confused or uncertain consumers do nothing. And people rarely buy anything of consequence without being asked.", author: "Dan Kennedy", source: "No B.S. Direct Marketing (2006), Rule 3" },
  { text: "\"Boring\" is what most people call the work it takes to become the best.", author: "Alex Hormozi", source: "X post, 30 Jun 2024" },
  { text: "The starting point of all achievement is desire. Weak desires bring weak results, just as a small amount of fire makes a small amount of heat.", author: "Napoleon Hill", source: "Think and Grow Rich (1937), ch. 9" },
  { text: "It is remarkable how much long-term advantage people like us have gotten by trying to be consistently not stupid, instead of trying to be very intelligent.", author: "Charlie Munger", source: "Wesco Financial letter to shareholders, 1989 annual report" },
  { text: "Conviction solves almost any sales problem.", author: "Alex Hormozi", source: "X post, 13 Sep 2024" },
  { text: "Setting the bar high in our approach to hiring has been, and will continue to be, the single most important element of Amazon.com's success.", author: "Jeff Bezos", source: "Amazon shareholder letter, 1997" },
  { text: "That's been one of my mantras: focus and simplicity. Simple can be harder than complex: You have to work hard to get your thinking clean to make it simple.", author: "Steve Jobs", source: "BusinessWeek interview, 25 May 1998" },
  { text: "Your competition isn't lucky. They just got tired of their excuses before you got tired of yours.", author: "Alex Hormozi", source: "X post, 23 Feb 2025" },
  { text: "Whoever does a thing best ought to be the one to do it.", author: "Henry Ford", source: "My Life and Work (1922)" },
  { text: "Exceed your customers' expectations. Give them what they want, and a little more.", author: "Sam Walton", source: "Made in America (1992), rule 8" },
  { text: "People often overestimate what will happen in the next two years and underestimate what will happen in ten.", author: "Bill Gates", source: "The Road Ahead (1996 edition)" },
  { text: "Find what works. Do more of what works. Find the thing preventing you from doing more of what works. Solve it. Do more of what works. Repeat.", author: "Alex Hormozi", source: "X post, 3 Sep 2024" },
  { text: "No one ever became a success without taking chances.", author: "Estee Lauder", source: "The Estee Lauder Companies, 'Our Founder'" },
  { text: "Become the best in the world at what you do. Keep redefining what you do until this is true.", author: "Naval Ravikant", source: "How to Get Rich tweetstorm, 2018" },
  { text: "Most crazy goals become realistic if you think about accomplishing them over ten years rather than one. Your goal isn't crazy, just your timeline.", author: "Alex Hormozi", source: "X post, 27 Dec 2024" },
  { text: "Whenever I interview someone for a job, I like to ask this question: \"What important truth do very few people agree with you on?\"", author: "Peter Thiel", source: "Zero to One (2014), p. 5" },
  { text: "The output of a manager is the output of the organizational units under his supervision or influence.", author: "Andy Grove", source: "High Output Management (1983)" },
  { text: "Good salesmen get someone to understand. Great salesmen get someone to feel understood.", author: "Alex Hormozi", source: "X post, 2 Sep 2026" },
  { text: "It's not the product that should be insanely great, but the experience of being your user.", author: "Paul Graham", source: "Do Things That Don't Scale, essay (2013)" },
  { text: "The only way to get the best of an argument is to avoid it.", author: "Dale Carnegie", source: "How to Win Friends and Influence People (1936), Part 3, Principle 1" },
  { text: "Don't count on motivation. Count on discipline.", author: "Jocko Willink", source: "Discipline Equals Freedom: Field Manual (2017); also The Tim Ferriss Show, 2016" },
];

/** Day zero of the cycle. */
const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;

/**
 * Today's quote. The calendar day in `timeZone` decides it, so everyone sees
 * the same line all day, and the list runs through all 100 before repeating
 * (index = days since 2026-01-01, mod 100).
 */
export function quoteForDay(date: Date, timeZone = "Europe/Prague"): Quote {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const day = Date.UTC(part("year"), part("month") - 1, part("day"));
  const days = Math.round((day - EPOCH_UTC) / DAY_MS);
  const n = QUOTES.length;
  return QUOTES[((days % n) + n) % n];
}
