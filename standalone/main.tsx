// Entry for the single-file offline build (npm run html): the same deck, without Next.js.
import { createRoot } from 'react-dom/client';
import Deck from '@/components/Deck';

createRoot(document.getElementById('root')!).render(<Deck />);
