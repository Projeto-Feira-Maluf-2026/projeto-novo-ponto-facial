import { useId, useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';

const details = [
  'A câmera continua no navegador. O enquadramento e o retorno ajudam a pessoa a entender a leitura sem expor a captura interna.',
  'O serviço facial transforma a imagem em características e as compara com os cadastros. A análise depende do modelo e das condições da captura.',
  'As regras da aplicação relacionam a presença à obra e à jornada. A interface recebe o resultado para mostrar a confirmação.',
  'O histórico permite consultar os registros por pessoa, obra e período. A notificação informa o retorno quando seu envio é confirmado.',
];
export function ArchitectureCard({ title, tech, description, index }: { title: string; tech: string; description: string; index: number }) {
  const [flipped, setFlipped] = useState(false);
  const detailsId = useId();
  return <div className="film-slab-surface film-card-surface" data-tilt data-tilt-strength="8" data-flipped={flipped}>
    <div className="film-card-rotor">
      <div className="film-card-face film-card-face-front" aria-hidden={flipped}>
        <span>{String(index+1).padStart(2,'0')}</span><div><h3>{title}</h3><p>{description}</p></div><small>{tech}</small>
        <img className="film-slab-art" src={`/presentation/${['capture','identity','record','confirmation'][index]}-light.webp`} alt="" width="960" height="960" loading="lazy" decoding="async" />
      </div>
      <div id={detailsId} className="film-card-face film-card-face-back" aria-hidden={!flipped}>
        <span className="film-eyebrow">Por dentro · {tech}</span><h3>{title}</h3><p>{details[index]}</p>
      </div>
    </div>
    <button className="film-btn film-btn-ghost film-card-toggle" type="button" aria-label={`${flipped ? 'Voltar ao card' : 'Ver por dentro'}: ${title}`} aria-expanded={flipped} aria-controls={detailsId} onClick={()=>setFlipped(value=>!value)}>
      {flipped ? 'Voltar ao card' : 'Ver por dentro'} {flipped ? <RotateCcw size={16} /> : <ArrowRight size={16} />}
    </button>
  </div>;
}
