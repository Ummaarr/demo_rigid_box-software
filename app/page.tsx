import { redirect } from "next/navigation";

// The proxy redirects unauthenticated users to /login, so sending the root
// straight to /dashboard is safe.
export default function Home() {
  redirect("/dashboard");
}
