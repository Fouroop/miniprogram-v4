-- 九年级数学题库预置（几何 + 函数），公共题 user_id=NULL
ALTER TABLE questions ADD COLUMN image_url VARCHAR(255) NULL DEFAULT NULL;

INSERT INTO questions (stem, answer, analysis, subject, grade, difficulty, status, user_id, image_url) VALUES
('如图，圆 O 的弦 AB 长为 240，OC⊥AB 于点 C，OC=40，求圆 O 的半径 r。', 'r = 130', '连接 OB。OC 垂直平分弦 AB，所以 BC=AB/2=120。在 Rt△OBC 中，OB²=OC²+BC²=40²+120²=16900，OB=130。', '数学', '九年级', '中等', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g1.png'),
('如图，点 A、B、C 在圆 O 上，∠AOB=80°，求圆周角 ∠ACB 的度数。', '∠ACB = 40°', '同弧所对的圆周角等于圆心角的一半：∠ACB = ∠AOB ÷ 2 = 80°÷2 = 40°。', '数学', '九年级', '容易', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g2.png'),
('如图，直线 l 切圆 O 于点 A，OA=6，切点 A 处切线与 OA 垂直，若直线 l 上点 P 满足 ∠P=30°（OP 与切线夹角为 30°），求 PA 的长。', 'PA = 6√3', '切线的性质：切线垂直于过切点的半径，OA⊥l。在 Rt△OAP 中，∠P=30°，OA=6 是 30°角的对边，所以 OP=12，PA=√(OP²-OA²)=√(144-36)=6√3。', '数学', '九年级', '较难', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g3.png'),
('如图，扇形 AOB 中 ∠AOB=90°，半径 OA=6，求弧 AB 的长和扇形 AOB 的面积。', '弧长 = 3π，面积 = 9π', '弧长 l=nπr/180=90×π×6/180=3π；扇形面积 S=nπr²/360=90×π×36/360=9π。', '数学', '九年级', '中等', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g4.png'),
('如图，在△ABC 中，D、E 分别在边 AB、AC 上，DE∥BC，AD=4，DB=2，AE=6，求 EC 的长。', 'EC = 3', 'DE∥BC 得△ADE∽△ABC，对应边成比例：AD/AB=AE/AC，即 4/(4+2)=6/(6+EC)，解得 EC=3。', '数学', '九年级', '中等', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g5.png'),
('如图，Rt△ABC 中 ∠C=90°，∠A=30°，BC=5，求斜边 AB 和直角边 AC 的长。', 'AB = 10，AC = 5√3', '30°角所对的直角边等于斜边一半：BC=AB/2，AB=10；AC=√(AB²-BC²)=√(100-25)=5√3。', '数学', '九年级', '容易', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g6.png'),
('如图，D、E 分别是等腰△ABC 的边 AB、AC 的中点，BC=16，求中位线 DE 的长。', 'DE = 8', '三角形中位线等于第三边的一半：DE=BC/2=16/2=8。', '数学', '九年级', '容易', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g7.png'),
('如图，梯形 ABCD 中，AD∥BC，AD=8，BC=14，EF 是梯形的中位线，求 EF 的长。', 'EF = 11', '梯形中位线等于上底与下底和的一半：EF=(AD+BC)/2=(8+14)/2=11。', '数学', '九年级', '容易', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g8.png'),
('如图，菱形 ABCD 的两条对角线 AC=12、BD=16，求菱形的边长。', '边长 = 10', '菱形对角线互相垂直且平分：AO=AC/2=6，BO=BD/2=8，边长 AB=√(6²+8²)=10。', '数学', '九年级', '中等', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g9.png'),
('如图，四边形 ABCD 内接于圆 O，∠A=70°，求 ∠C 的度数。', '∠C = 110°', '圆内接四边形对角互补：∠C=180°-∠A=180°-70°=110°。', '数学', '九年级', '容易', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g10.png'),
('如图，抛物线 y=x²-4x+3，求它的顶点坐标和与 x 轴的交点坐标。', '顶点 (2,-1)；x 轴交点 (1,0)、(3,0)', '配方法：y=(x-2)²-1，顶点为 (2,-1)；令 y=0 得 x²-4x+3=0，即 (x-1)(x-3)=0，x=1 或 3。', '数学', '九年级', '中等', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g11.png'),
('如图，抛物线 y=-x²+2x+3，求它的顶点坐标和函数的最大值。', '顶点 (1,4)，最大值 4', '配方法：y=-(x-1)²+4，开口向下，顶点 (1,4) 即为最高点，最大值为 4。', '数学', '九年级', '中等', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g12.png'),
('如图，反比例函数 y=6/x 的图像。当 x=3 时，求 y 的值；当 y=2 时，求 x 的值。', 'x=3 时 y=2；y=2 时 x=3', '代入即可：x=3 → y=6/3=2；y=2 → 2=6/x → x=3。', '数学', '九年级', '容易', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g13.png'),
('如图，一次函数 y=x-1 与反比例函数 y=2/x 的图像交于点 P(2,1) 和另一点 Q，求点 Q 的坐标。', 'Q(-1,-2)', '联立方程组：x-1=2/x → x²-x-2=0 → (x-2)(x+1)=0，x=2 或 -1。x=-1 时 y=-2，所以 Q(-1,-2)。', '数学', '九年级', '较难', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g14.png'),
('如图，抛物线 y=x²-2x 在 0≤x≤3 范围内的最大值和最小值各是多少？', '最大值 3，最小值 -1', '对称轴 x=1 在区间内：最小值 y(1)=1-2=-1；端点值 y(0)=0，y(3)=9-6=3，所以最大值 3。', '数学', '九年级', '较难', '未学习', NULL, 'https://zblw.com.cn/cuoti/uploads/questions/g15.png'),
('将抛物线 y=x² 先向右平移 2 个单位，再向上平移 3 个单位，求所得抛物线的解析式。', 'y = (x-2)² + 3', '平移口诀"左加右减、上加下减"：向右平移 2 → y=(x-2)²，再向上 3 → y=(x-2)²+3。', '数学', '九年级', '容易', '未学习', NULL, NULL),
('已知抛物线 y=x²-2x+m 与 x 轴有两个不同的交点，求 m 的取值范围。', 'm < 1', '与 x 轴有两个交点 ⟺ Δ>0：Δ=(-2)²-4×1×m=4-4m>0，解得 m<1。', '数学', '九年级', '中等', '未学习', NULL, NULL),
('反比例函数 y=k/x 的图像经过点 (2,-4)，求 k 的值，并判断在每个象限内 y 随 x 的增大如何变化。', 'k=-8；y 随 x 增大而增大', 'k=xy=2×(-4)=-8。k<0 时，图像在二、四象限，每个象限内 y 随 x 增大而增大。', '数学', '九年级', '中等', '未学习', NULL, NULL),
('某商品涨价 x 元后利润为 y=-2x²+12x，问涨价多少元时利润最大？最大利润是多少？', '涨价 3 元，最大利润 18', '二次函数顶点：x=-b/(2a)=-12/(2×(-2))=3；y=-2×9+36=18。', '数学', '九年级', '中等', '未学习', NULL, NULL),
('某斜坡的坡角为 30°，坡面长 100 米，求该斜坡的垂直高度。', '50 米', '垂直高度 = 坡面长 × sin30° = 100 × 1/2 = 50 米。', '数学', '九年级', '容易', '未学习', NULL, NULL);
