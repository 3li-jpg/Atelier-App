import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import VioletBloom from "@/components/VioletBloom";
import Pricing from "@/components/Pricing";
import SignupForm from "@/components/SignupForm";
import Footer from "@/components/Footer";

export default function Page() {
  return (
    <>
      <Navbar />
      <Hero />
      <Features />
      <VioletBloom />
      <Pricing />
      <SignupForm />
      <Footer />
    </>
  );
}
