import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ArchitectureCard } from './ArchitectureCard';
afterEach(cleanup);
it('reveals the technical explanation through an accessible flip control',()=>{
  render(<ArchitectureCard title="Interface" tech="React" description="Câmera e retorno" index={0} />);
  const button=screen.getByRole('button',{name:'Ver por dentro: Interface'});
  expect(button).toHaveAttribute('aria-expanded','false');
  fireEvent.click(button);
  expect(screen.getByRole('button',{name:'Voltar ao card: Interface'})).toHaveAttribute('aria-expanded','true');
  expect(screen.getByRole('heading',{name:'Interface'})).toBeInTheDocument();
  const panel=document.getElementById(button.getAttribute('aria-controls')!);
  expect(panel).toHaveAttribute('aria-hidden','false');
  expect(panel).toHaveTextContent('A câmera continua no navegador');
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded','false');
  expect(panel).toHaveAttribute('aria-hidden','true');
});
