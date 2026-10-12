/** Synthetic editorial artwork; never a participant image or an embedding. */
export function AttendanceSequence() {
  const artworks = [
    ['capture', 'face'], ['identity', 'vectors'], ['record', 'record'], ['confirmation', 'mail'],
  ];
  return (
    <div className="film-sequence" aria-hidden="true">
      <div className="film-sequence-caption"><span>Do gesto à evidência</span><span>Imagens ilustrativas geradas por IA</span></div>
      <div className="film-sequence-artwork">
        {artworks.map(([file, phase], index) => <img
          key={file} className={`film-sequence-${phase}`}
          src={`/presentation/${file}-light.webp`} alt="" width="960" height="960"
          loading={index === 0 ? 'eager' : 'lazy'} decoding="async"
        />)}
      </div>
      <div className="film-sequence-footer"><span>Imagem</span><span>Identidade</span><span>Registro</span><span>Retorno</span></div>
    </div>
  );
}
