import { container, titulo } from './estilo';

const PASSOS = [
  { titulo: 'Crie a conta', texto: 'Nome do negócio, seu e-mail e uma senha. Leva poucos minutos e você já entra no sistema, sem instalar nada.' },
  { titulo: 'Siga os primeiros passos', texto: 'O assistente pede só o que falta para o seu tipo de negócio: serviços ou produtos, quem atende e o horário de funcionamento.' },
  { titulo: 'Conecte o WhatsApp', texto: 'Leia o QR Code com o celular do negócio. A partir daí, os lembretes e as confirmações saem sozinhos.' },
];

export default function ComoFunciona() {
  return (
    <section id="como-funciona" aria-labelledby="titulo-como" className="scroll-mt-20 bg-white border-y border-[#E3E5E8]">
      <div className={`${container} py-16 md:py-20`}>
        <h2 id="titulo-como" className={`${titulo} text-[32px] md:text-[40px] leading-[1.1] font-bold m-0 max-w-[640px]`}>
          Do cadastro ao primeiro lembrete no mesmo dia
        </h2>
        <ol className="list-none p-0 m-0 mt-10 grid gap-8 md:gap-5 md:grid-cols-3">
          {PASSOS.map((p, i) => (
            <li key={p.titulo} className="border-t-2 border-[#15171A] pt-5">
              <span className={`${titulo} text-[15px] font-bold text-[#136F4D]`} aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-2 mb-0 text-xl font-semibold">
                <span className="sr-only">Passo {i + 1}: </span>{p.titulo}
              </h3>
              <p className="mt-2 mb-0 text-[#4A5059] leading-relaxed">{p.texto}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
