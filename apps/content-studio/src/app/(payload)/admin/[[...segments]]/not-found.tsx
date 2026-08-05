import config from "@payload-config";
import { generatePageMetadata, NotFoundPage } from "@payloadcms/next/views";
import type { Metadata } from "next";
import { importMap } from "../importMap";

type Props = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<Record<string, string | string[]>>;
};

export const generateMetadata = ({ params, searchParams }: Props): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams });

export default function AdminNotFound({ params, searchParams }: Props) {
  return NotFoundPage({ config, params, searchParams, importMap });
}
