'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

export type HourBucket = {
  label: string
  kitchen: number
  living_room: number
}

interface Props {
  data: HourBucket[]
}

export default function ActivityTimeline({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barSize={8}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8f4f3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: '#5a7975' }}
          tickLine={false}
          axisLine={false}
          interval={3}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#5a7975' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: '1px solid #d1ebe8', fontSize: 12 }}
          cursor={{ fill: 'rgba(91,191,181,0.06)' }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(value) => value === 'living_room' ? 'Living Room' : 'Kitchen'}
        />
        <Bar dataKey="kitchen"     name="kitchen"     fill="#5BBFB5" radius={[3, 3, 0, 0]} />
        <Bar dataKey="living_room" name="living_room" fill="#3A9E94" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
