
import { useEffect, useRef, useState } from 'react';

type SampleType = 'T1' | 'T2' | 'T3' | 'T4';

type Sample = {
  seq: number;
  type: SampleType;
  claim: string;
  source: string;
  title: string;
  branch: string;
  expected: string;
};

const TYPE_INFO: Record<
  SampleType,
  { label: string; description: string }
> = {
  T1: {
    label: '수집 대상 기관 아님',
    description: '현재 수집 대상에 포함되지 않은 기관의 자료',
  },
  T2: {
    label: '관련 자료 있음',
    description: '수집 DB에서 관련 근거를 찾을 수 있는 사례',
  },
  T3: {
    label: '수집 누락',
    description: '수집 대상 기관이지만 색인에 없는 사례',
  },
  T4: {
    label: '수집 기간 밖',
    description: '현재 자료 수집 기간을 벗어난 사례',
  },
};

const SAMPLES: Sample[] = [
  // T1: 수집 대상 기관 아님
  {
    seq: 2,
    type: 'T1',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '외교부',
    title: '에볼라바이러스병 확산 관련 콩고민주공화국 이투리州 여행금지 발령',
    claim:
      '외교부는 에볼라바이러스병 확산에 따라 5월 22일 14시부터 콩고민주공화국 이투리주에 여행경보 4단계인 여행금지를 발령했다.',
  },
  {
    seq: 3,
    type: 'T1',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '농림축산식품부',
    title: '유전체 기반 한우 암소 개량 본격화... 전국 우수암소 2천두 선정',
    claim:
      '농식품부는 한우 유전체 관리 시스템에 등록된 암소 22만여 두의 유전능력을 평가해 전국 1,022호 농가 및 기관에서 우량암소 2천 두를 최종 선발했다.',
  },
  {
    seq: 5,
    type: 'T1',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '해양수산부',
    title: '여객선 공영항로 공공기관이 운영한다...2027년 시행 앞서 준비 착수',
    claim:
      '해양수산부는 2027년 1월 1일부터 국가보조항로를 공영항로로 변경하고, 기존 민간 위탁 방식에서 공공기관 위탁 운영방식으로 전환할 예정이다.',
  },
  {
    seq: 7,
    type: 'T1',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '산림청',
    title: '산림청, ‘한반도 산림포럼’ 출범',
    claim:
      '산림청은 남북 산림교류·협력 방안을 논의하기 위해 학계·연구기관·국제기구·국제NGO 등 전문가가 참여하는 총 20명 규모의 ‘한반도 산림포럼’을 출범했다.',
  },
  {
    seq: 9,
    type: 'T1',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '금융위원회',
    title: '새도약기금, 농협자산관리회사·상호금융권 등 보유 연체채권 매입',
    claim:
      '새도약기금은 1~5차 매입을 통해 약 9.1조 원 규모의 장기연체채권을 확보했으며, 중복을 포함한 수혜자는 약 75만 명이다.',
  },

  // T2: 관련 자료 있음
  {
    seq: 12,
    type: 'T2',
    branch: '원문',
    expected: '관련 자료 제시',
    source: '국민건강보험공단',
    title: '국민건강보험공단, ‘2026 하늘반창고 진료비 지원사업’ 기부금 전달식 개최',
    claim:
      '보호시설 거주 아동 중 ADHD(주의력 결핍 및 과잉행동장애)등 전문적인 케어가 필요한 아동은 병원 내 치료뿐만 아니라 병원 밖 치료의 병행이 필요한 경우까지 지원 범위를 확대하였다.',
  },
  {
    seq: 21,
    type: 'T2',
    branch: '바꿔씀',
    expected: '관련 자료 제시',
    source: '교육부',
    title: '2026 대안교육기관 교육·활동 프로그램 우수사례 공모전 개최',
    claim:
      '교육부는 시·도교육청에 등록된 대안교육기관을 대상으로 5월 26일부터 8월 12일까지 교육·활동 프로그램 우수사례 공모전을 진행한다.',
  },
  {
    seq: 23,
    type: 'T2',
    branch: '바꿔씀',
    expected: '관련 자료 제시',
    source: '행정안전부',
    title: '폭염 취약계층 지원대책 점검회의 개최',
    claim:
      '행정안전부는 5월 22일 관계기관 점검회의를 열고 쪽방주민·독거노인 등 폭염 취약계층의 안전관리와 현장 지원 대책을 강화하는 방안을 논의했다.',
  },
  {
    seq: 31,
    type: 'T2',
    branch: '비틂',
    expected: '관련 자료 제시',
    source: '정책브리핑',
    title: '해외 기술규제 애로, 국민과 함께 해법 찾는다',
    claim:
      '제11회 무역기술장벽(TBT) 논문공모전 참가자는 5월 26일부터 11월 23일까지 신청서와 논문을 제출할 수 있다.',
  },
  {
    seq: 32,
    type: 'T2',
    branch: '비틂',
    expected: '관련 자료 제시',
    source: '정책브리핑',
    title: '올해 1분기 부패·공익신고자 64명에게 총 보상금 9억 1천여만 원 지급',
    claim:
      '국민권익위원회는 올해 1분기 부패·공익신고자 74명에게 총 9억 1천여만 원의 보상금을 지급했으며, 신고를 통한 공공기관 수입회복 결정액은 약 494억 원이다.',
  },

  // T3: 수집 대상이나 색인에 없음
  {
    seq: 41,
    type: 'T3',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '경찰청',
    title: '경찰청-남양유업, 우유 팩 통해 가정폭력 예방 메시지 전한다',
    claim:
      '경찰청은 가정폭력 예방을 위해 5월 20일부터 7월 19일까지 2개월간 남양유업 우유 140만 개에 가정폭력 예방 메시지를 담아 대국민 캠페인을 진행한다.',
  },
  {
    seq: 43,
    type: 'T3',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '행정안전부',
    title: 'BTS 부산 공연 대비 관계기관 합동 숙박업소 바가지요금 특별 현장 점검',
    claim:
      '정부는 BTS 부산공연을 앞두고 5월 29일, 6월 8일, 6월 9일 총 3회 관계기관 합동 특별현장 점검을 실시해 숙박업소의 가격표시제 준수 여부 등을 점검한다.',
  },
  {
    seq: 44,
    type: 'T3',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '행정안전부',
    title: '5극3특 균형성장 본격 추진 기반 마련, ‘지방분권균형발전법’ 개정안 국회 통과',
    claim:
      '개정 지방분권균형발전법에 따라 균형성장영향평가와 초광역특별협약 관련 규정은 공포 후 6개월 뒤부터, 초광역특별계정은 2027년 1월 1일부터 적용된다.',
  },
  {
    seq: 45,
    type: 'T3',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '행정안전부',
    title: '국가기록원, 132년 전 민중의 열망 담긴 동학농민혁명 기록물 되살려',
    claim:
      '국가기록원은 2008년부터 맞춤형 복원·복제 지원 서비스를 운영해 현재까지 82개 민간·공공기관의 기록물 3,942매를 처리했다.',
  },
  {
    seq: 47,
    type: 'T3',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '고용노동부',
    title: '2026년 직장어린이집 설치 의무미이행 10개 사업장 명단 공표',
    claim:
      '2025년 기준 실태조사 결과, 직장어린이집 설치 의무 이행률은 94.9%로, 설치 의무 대상 사업장 1,674개소 중 총 1,588개소가 의무를 이행한 것으로 나타났다.',
  },

  // T4: 수집 기간 밖
  {
    seq: 64,
    type: 'T4',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '국토교통부',
    title: '울산화력발전소 보일러타워 붕괴사고 조사결과',
    claim:
      '울산화력발전소 보일러타워 붕괴사고는 사전 취약화 작업에서 기둥을 한계 이상으로 과다 절단해 국부좌굴이 발생한 것이 직접적인 붕괴 원인으로 조사됐다.',
  },
  {
    seq: 65,
    type: 'T4',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '국토교통부',
    title: '제34회 물류의 날 기념식 … 물류산업의 지속가능 발전방향 모색',
    claim:
      '제34회 물류의 날 기념식에서는 물류산업 발전에 기여한 기업인과 단체에 훈장 1점, 산업포장 2점, 대통령표창 4점 등 총 58점을 포상한다.',
  },
  {
    seq: 68,
    type: 'T4',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '교육부',
    title: '인공지능시대 사이버보안 영재교육 지원을 위한 교육부·LG유플러스·티오리한국 업무협약 체결',
    claim:
      '제12회 정보보안 경진대회 단체전 본선에는 4개 권역에서 선발된 12개 팀, 총 48명이 참가해 정보보안 기술과 협업 역량을 겨룬다.',
  },
  {
    seq: 70,
    type: 'T4',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '고용노동부',
    title: '한국장애인고용공단 고용개발원, 제18회 장애인고용패널 학술대회 개최',
    claim:
      '한국장애인고용공단 고용개발원은 11월 6일 제18회 장애인고용패널 학술대회를 개최하고, 2025년 구축한 장애인고용패널 3차 코호트의 첫 연구 성과를 발표한다.',
  },
  {
    seq: 73,
    type: 'T4',
    branch: '자료 부족',
    expected: '유보·후보없음',
    source: '식품의약품안전처',
    title: "[보도참고] 카드뮴 기준 초과 검출된 '기타 수산물가공품' 회수 조치",
    claim:
      '한라식품의 ‘황새치’에서는 카드뮴이 기준치 0.2mg/kg의 3배인 0.6mg/kg, 정필의 ‘황새치 복육’에서는 0.3mg/kg 검출돼 판매 중단 및 회수 조치됐다.',
  },
];

type TextInputProps = {
  onAnalyze: (text: string) => void;
  isAnalyzing: boolean;
  onReset: () => void;
};

export default function TextInput({
  onAnalyze,
  isAnalyzing,
  onReset,
}: TextInputProps) {
  const [value, setValue] = useState('');
  const [active, setActive] = useState<number | null>(null);
  const [openType, setOpenType] = useState<SampleType | null>(
    null,
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) return;

    textarea.style.height = 'auto';

    const maxHeight = 85;
    const nextHeight = Math.min(
      textarea.scrollHeight,
      maxHeight,
    );

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight
        ? 'auto'
        : 'hidden';
  }, [value]);

  useEffect(() => {
    if (!openType) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenType(null);
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) {
        return;
      }

      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled])',
        ),
      );

      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (
        event.shiftKey &&
        document.activeElement === first
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    requestAnimationFrame(() => {
      modalRef.current
        ?.querySelector<HTMLButtonElement>(
          '.text-sample-modal-close',
        )
        ?.focus();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [openType]);

  const reset = () => {
    setValue('');
    setActive(null);
    setOpenType(null);
    onReset();
  };

  const analyze = () => {
    const text = value.trim();

    if (text && !isAnalyzing) {
      onAnalyze(text);
    }
  };

const openModal = (type: SampleType) => {
  previousFocusRef.current =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  setOpenType(type);
};

  const chooseSample = (sample: Sample) => {
    setValue(sample.claim);
    setActive(sample.seq);
    setOpenType(null);

    // 선택한 문장을 입력창에 채우기만 한다.
    // 실제 검색은 기존 '관련 자료 찾기' 버튼으로 실행한다.
    onReset();

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const visibleSamples = openType
    ? SAMPLES.filter((sample) => sample.type === openType)
    : [];

  return (
    <div className="text-input-panel">
      <label htmlFor="text-claim">
        검토 문장 입력
      </label>

      <div className="text-input-row">
        <div className="text-field-wrap">
          <textarea
            ref={textareaRef}
            id="text-claim"
            value={value}
            rows={1}
            onChange={(event) => {
              setValue(event.target.value);
              setActive(null);
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey
              ) {
                event.preventDefault();
                analyze();
              }
            }}
            placeholder="검토할 기사 문장을 입력하세요"
            aria-describedby="text-input-help"
          />

          {value && (
            <button
              className="text-clear"
              type="button"
              onClick={reset}
              aria-label="입력 및 검색 결과 초기화"
            >
              ×
            </button>
          )}
        </div>

        <button
          className="btn btn-primary"
          type="button"
          disabled={!value.trim() || isAnalyzing}
          onClick={analyze}
        >
          {isAnalyzing
            ? '자료 찾는 중…'
            : '관련 자료 찾기'}
        </button>
      </div>

      <p
        className="text-input-help"
        id="text-input-help"
      >
        Enter로 검색하고 Shift+Enter로 줄바꿈할 수
        있습니다.
      </p>

      <p className="text-hint">
        자동으로 사실·거짓을 판정하지 않습니다.
        입력한 내용과 대조해 볼 수 있는 공식자료를
        찾아 보여줍니다.
      </p>

      <div className="text-samples">
        {(
          ['T1', 'T2', 'T3', 'T4'] as SampleType[]
        ).map((type) => (
          <button
            type="button"
            key={type}

className={
  openType === type ||
  (active !== null &&
    SAMPLES.some(
      (sample) =>
        sample.seq === active &&
        sample.type === type,
    ))
    ? 'active'
    : ''
}
aria-pressed={
  openType === type ||
  (active !== null &&
    SAMPLES.some(
      (sample) =>
        sample.seq === active &&
        sample.type === type,
    ))
}

            onClick={() => openModal(type)}
            aria-haspopup="dialog"
          >
            {type} {TYPE_INFO[type].label}
          </button>
        ))}
      </div>

      {openType && (
        <div
          className="text-sample-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpenType(null);
            }
          }}
        >
          <div
            ref={modalRef}
            className="text-sample-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="text-sample-modal-title"
            aria-describedby="text-sample-modal-description"
          >
            <div className="text-sample-modal-header">
              <div>
                <div className="text-sample-modal-kicker">
                  시연 사례 선택 · {openType}
                </div>

                <h2 id="text-sample-modal-title">
                  {TYPE_INFO[openType].label}
                </h2>

                <p id="text-sample-modal-description">
                  {TYPE_INFO[openType].description}
                </p>
              </div>

              <button
                type="button"
                className="text-sample-modal-close"
                onClick={() => setOpenType(null)}
                aria-label="팝업 닫기"
              >
                ×
              </button>
            </div>

            <div className="text-sample-modal-body">
              <p className="text-sample-modal-count">
                사례 {visibleSamples.length}건
              </p>

              {visibleSamples.map((sample, index) => (
                <button
                  key={sample.seq}
                  type="button"
                  className="text-sample-item"
                  onClick={() => chooseSample(sample)}
                >
                  <div className="text-sample-item-top">
                    <span className="text-sample-number">
                      사례 {index + 1}
                    </span>

                    <span className="text-sample-branch">
                      {sample.branch}
                    </span>
                  </div>

                  <div className="text-sample-claim">
                    {sample.claim}
                  </div>

                  <div className="text-sample-source">
                    <strong>{sample.source}</strong>
                    <span> · </span>
                    <span>{sample.title}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="text-sample-modal-footer">
              사례를 선택하면 입력창에 문장이
              들어갑니다. 분석은 '관련 자료 찾기'
              버튼을 눌러 실행합니다.
            </div>
          </div>
        </div>
      )}

      <style>{`
        .text-sample-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding: 7vh 16px 24px;
          background: rgba(15, 23, 42, 0.52);
          overflow-y: auto;
        }

        .text-samples button.active {
  background: #eff6ff;
  color: #2563eb;
  border: 1px solid #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
  font-weight: 700;
}

.text-samples button.active:hover {
  background: #dbeafe;
}

        .text-sample-modal {
          width: min(720px, 100%);
          max-height: 86vh;
          display: flex;
          flex-direction: column;
          background: #ffffff;
          color: #172033;
          border-radius: 16px;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.22);
          overflow: hidden;
        }

        .text-sample-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          padding: 24px 26px 18px;
          border-bottom: 1px solid #e5eaf1;
        }

        .text-sample-modal-kicker {
          margin-bottom: 7px;
          color: #2563eb;
          font-size: 12px;
          font-weight: 700;
        }

        .text-sample-modal-header h2 {
          margin: 0;
          color: #172033;
          font-size: 21px;
          font-weight: 750;
        }

        .text-sample-modal-header p {
          margin: 9px 0 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.6;
        }

        .text-sample-modal-close {
          flex-shrink: 0;
          width: 34px;
          height: 34px;
          display: grid;
          place-items: center;
          border: 1px solid #e2e8f0;
          border-radius: 9px;
          background: #fff;
          color: #64748b;
          font-size: 24px;
          cursor: pointer;
        }

        .text-sample-modal-close:hover {
          background: #f1f5f9;
        }

        .text-sample-modal-body {
          overflow-y: auto;
          padding: 16px 24px 24px;
        }

        .text-sample-modal-count {
          margin: 0 0 12px;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
        }

        .text-sample-item {
          display: block;
          width: 100%;
          padding: 16px 18px;
          margin-bottom: 10px;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background: #fff;
          color: #172033;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.15s,
                      background 0.15s,
                      box-shadow 0.15s;
        }

        .text-sample-item:hover {
          border-color: #60a5fa;
          background: #f8fbff;
          box-shadow: 0 2px 8px rgba(37, 99, 235, 0.08);
        }

        .text-sample-item:focus-visible,
        .text-sample-modal-close:focus-visible {
          outline: 3px solid #93c5fd;
          outline-offset: 2px;
        }

        .text-sample-item-top {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }

        .text-sample-number {
          color: #2563eb;
          font-size: 12px;
          font-weight: 750;
        }

        .text-sample-branch {
          padding: 3px 8px;
          border-radius: 5px;
          background: #eff6ff;
          color: #2563eb;
          font-size: 11px;
          font-weight: 600;
        }

        .text-sample-claim {
          color: #1e293b;
          font-size: 14px;
          font-weight: 550;
          line-height: 1.75;
          white-space: normal;
          overflow-wrap: anywhere;
        }

        .text-sample-source {
          margin-top: 11px;
          color: #64748b;
          font-size: 12px;
          line-height: 1.6;
          overflow-wrap: anywhere;
        }

        .text-sample-source strong {
          color: #475569;
        }

        .text-sample-modal-footer {
          padding: 14px 24px;
          border-top: 1px solid #e5eaf1;
          background: #f8fafc;
          color: #64748b;
          font-size: 12px;
          line-height: 1.6;
        }

        @media (max-width: 600px) {
          .text-sample-overlay {
            padding: 4vh 10px 16px;
          }

          .text-sample-modal {
            max-height: 92vh;
            border-radius: 12px;
          }

          .text-sample-modal-header {
            padding: 18px 16px 14px;
          }

          .text-sample-modal-header h2 {
            font-size: 18px;
          }

          .text-sample-modal-body {
            padding: 12px;
          }

          .text-sample-item {
            padding: 14px;
          }

          .text-sample-modal-footer {
            padding: 12px 16px;
          }
        }
      `}</style>
    </div>
  );
}
