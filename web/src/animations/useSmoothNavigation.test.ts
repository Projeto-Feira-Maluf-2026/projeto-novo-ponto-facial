import { describe, expect, it } from 'vitest';
import { routeLinkDestination } from './useSmoothNavigation';

function click(href: string, options: MouseEventInit = {}, attributes: Record<string,string> = {}) {
  const a = document.createElement('a');
  a.href = href;
  Object.entries(attributes).forEach(([name,value])=>a.setAttribute(name,value));
  const icon = document.createElement('span'); a.append(icon);
  const event = new MouseEvent('click', {bubbles:true,cancelable:true,...options});
  Object.defineProperty(event,'target',{value:icon});
  return event;
}
describe('native page transition navigation boundaries',()=>{
  it('keeps query and hash on internal route navigation',()=>{
    expect(routeLinkDestination(click('https://app.example.test/obras?obra=2#detalhes'),'https://app.example.test/')).toBe('/obras?obra=2#detalhes');
  });
  it.each([{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}])('preserves browser gestures: %o', options=>{
    expect(routeLinkDestination(click('https://app.example.test/obras',options),'https://app.example.test/')).toBeNull();
  });
  it.each([
    ['https://other.example/obras',{}],
    ['https://app.example.test/obras',{target:'_blank'}],
    ['https://app.example.test/obras',{download:''}],
    ['https://app.example.test/?filter=active',{}],
    ['https://app.example.test/#detalhes',{}],
  ])('does not intercept external, download or same-page links', (href,attributes)=>{
    expect(routeLinkDestination(click(href,{},attributes),'https://app.example.test/')).toBeNull();
  });
  it('respects a click already handled by another component',()=>{
    const event=click('https://app.example.test/obras'); event.preventDefault();
    expect(routeLinkDestination(event,'https://app.example.test/')).toBeNull();
  });
});
