import { Still } from "remotion";
import { RecipeintAvatar, RecipeintXBanner } from "./stills";

export const RemotionRoot = () => (
  <>
    <Still id="RecipeintAvatar" component={RecipeintAvatar} width={1000} height={1000} />
    <Still id="RecipeintXBanner" component={RecipeintXBanner} width={1500} height={500} />
  </>
);
