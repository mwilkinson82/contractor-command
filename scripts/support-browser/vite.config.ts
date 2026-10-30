import {defineConfig} from "vite";import react from "@vitejs/plugin-react";import tailwind from "@tailwindcss/vite";import {resolve} from "node:path";
const root=resolve(process.cwd(),"scripts/support-browser");
export default defineConfig({root,plugins:[react(),tailwind()],resolve:{alias:[
{find:"@/lib/support/dashboard.functions",replacement:resolve(root,"mock.tsx")},
{find:"@/hooks/use-auth",replacement:resolve(root,"mock.tsx")},
{find:"@/hooks/use-is-admin",replacement:resolve(root,"mock.tsx")},
{find:"@tanstack/react-router",replacement:resolve(root,"mock.tsx")},
{find:"@tanstack/react-start",replacement:resolve(root,"mock.tsx")},
{find:"@",replacement:resolve(process.cwd(),"src")}]},server:{host:"127.0.0.1",port:4178,strictPort:true}});