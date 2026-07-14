/**
 * Landing components barrel — exports everything needed to compose
 * the landing-page IDE chrome + sections in the web app.
 *
 * Importing from this barrel also imports the CSS (side-effect import),
 * so consumers don't need to manually import the stylesheet.
 */
import "./landing.css"

export { WinChrome } from "./WinChrome"
export { ChatMock, DiffMock, SubMock, PrMock, ProcessMock } from "./Mockups"
export { HeroMockup } from "./HeroMockup"
export type { HeroMockupProps } from "./HeroMockup"
export { Reveal } from "./Reveal"
export { Check, Star, featureIcons, toolIcons } from "./icons"
export { SectionTag, SectionTitle, SectionSub } from "./Sections"
