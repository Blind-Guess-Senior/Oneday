import { defineCollection } from "astro:content";
import { reviewsLoader, standardsLoader } from "./lib/loader";

export const collections = {
  reviews: defineCollection({ loader: reviewsLoader() }),
  standards: defineCollection({ loader: standardsLoader() }),
};
