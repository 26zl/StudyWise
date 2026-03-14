/*
 * Profil loading UI – vises ved navigering til /profil mens siden lastes.
 */
import { LoadingView } from "@/app/components/ui/Loading";

export default function ProfilLoading() {
  return <LoadingView text="Laster profil..." />;
}
