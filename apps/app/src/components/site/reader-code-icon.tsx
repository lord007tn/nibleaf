import { FileCode } from 'lucide-react';
import { hasIcon, PageIcon } from './page-icon';

export default function CodeIcon({ name, className }: { name?: string; className?: string }) {
  return hasIcon(name) ? <PageIcon name={name} className={className} /> : <FileCode className={className} aria-hidden />;
}
