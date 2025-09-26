import { icons } from "lucide-react";

const Icon = ({
  name,
  ...props
}: {
  name: keyof typeof icons;
  [key: string]: any;
}) => {
  const LucideIcon = icons[name];

  return <LucideIcon {...props} />;
};

export default Icon;
