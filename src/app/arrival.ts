import type { Arrival, DataSource } from './data.ts';

/**
 * 津波の到達時間（その県で公表されている最も低い高さ）。自宅のマスが自分で持つ市町村の分だけを使う。
 * 周辺から推測した市町名（表示用）は使わない（県境などで別の市町の時間を当てないため）。決まらない・読めないときは null。
 */
export async function homeArrival(ds: Pick<DataSource, 'municipalityOf' | 'tsunamiArrival'>, homeMesh: string): Promise<Arrival | null> {
  try {
    const own = await ds.municipalityOf(homeMesh);
    return own ? await ds.tsunamiArrival(own) : null;
  } catch {
    return null;
  }
}
