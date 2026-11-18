import { T } from 'gt-react';
import { n, part, plural, t } from 'gt-react/unstable';
import type { RouteProps } from '../App';
import { Badge } from '../shared/Badge';
import { Glossary } from '../shared/Glossary';

export default function Orders({ count }: RouteProps) {
  return (
    <section data-route='orders'>
      <h2 data-test='heading'>{t`Recent orders`}</h2>
      <p data-test='orders'>
        {t`${plural({ count }, { one: part`${n} order is waiting`, other: part`${n} orders are waiting` })}`}
      </p>
      <T>
        <p data-test='jsx'>
          Orders ship within <b>two days</b>.
        </p>
      </T>
      <Badge />
      <Glossary />
    </section>
  );
}
