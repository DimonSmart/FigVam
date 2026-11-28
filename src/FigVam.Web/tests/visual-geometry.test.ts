import { describe, expect, it } from 'vitest';
import { closestSnap, proportionalSize, validGridStep, clampGuide, decodeGuides } from '../src/canvas/visual-geometry';
describe('visual geometry',()=>{
  it('snaps to the nearest target across edges and centers',()=>{
    expect(closestSnap([11,31,51],[10,33,55],null,6)).toEqual({delta:-1,guide:10});
    expect(closestSnap([13],[20],10,2)).toBeNull();
    expect(closestSnap([-18],[],10,3)).toEqual({delta:-2,guide:-20});
    expect(closestSnap([18],[19],10,3)).toEqual({delta:1,guide:19});
    expect(closestSnap([16],[20],null,3)).toBeNull();
  });
  it('preserves aspect ratio when the dominant axis changes or either size hits a bound',()=>{
    const range={min:1,max:1000};
    expect(proportionalSize(100,50,40,0,range,range)).toEqual([140,70]);
    expect(proportionalSize(100,50,0,25,range,range)).toEqual([150,75]);
    expect(proportionalSize(100,50,100,0,range,{min:1,max:60})).toEqual([120,60]);
    expect(proportionalSize(100,50,-200,0,{min:20,max:1000},range)).toEqual([20,10]);
    expect(proportionalSize(0,50,2,2,range,range)).toBeNull();
  });
  it('validates locally saved guides and clamps positions to the screen',()=>{
    expect(decodeGuides([{id:'a',axis:'x',position:30},{id:'a',axis:'y',position:10},{id:'b',axis:'z',position:30},null,{id:'c',axis:'y',position:NaN}])).toEqual([{id:'a',axis:'x',position:30}]);
    expect(clampGuide(-3,100)).toBe(0);expect(clampGuide(103,100)).toBe(100);expect(clampGuide(1.12345,100)).toBe(1.123);
  });
  it('validates grid step',()=>{
    expect(validGridStep(20)).toBe(true);
    for(const value of [0,-1,2.5,Infinity,501])expect(validGridStep(value)).toBe(false);
  });
});
